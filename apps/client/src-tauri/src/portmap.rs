//! Asks the home router to forward a UDP port to the one WebRTC is using, so a peer behind a strict NAT (most mobile
//! carriers) can reach us directly instead of through the relay. The page learns the port from its own ICE candidates,
//! asks for a mapping here, and sends the other peer one extra candidate with the router's public address.
//!
//! UPnP is tried first because it finds the router without knowing its address; PCP and then NAT-PMP follow, sent to
//! the default gateway. A mapping is renewed while it is held and removed when it is released or the app exits.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::num::NonZeroU16;
use std::time::{Duration, Instant};

use crab_nat::{
    natpmp, InternetProtocol, PortMapping, PortMappingOptions, PortMappingType, TimeoutConfig,
};
use igd_next::aio::tokio::{search_gateway, Tokio};
use igd_next::aio::Gateway;
use igd_next::{
    AddAnyPortError, AddPortError, GatewayIpVersion, PortMappingProtocol, SearchOptions,
};
use serde::Serialize;
use tokio::sync::{oneshot, Mutex};

/// Asked of the router; it may grant less. Renewed at half of what it grants.
const LEASE_SECONDS: u32 = 20 * 60;
/// A renewal that failed is tried again after this long.
const RETRY_RENEW: Duration = Duration::from_secs(60);
/// Every peer connection uses its own port, so this bounds a large call (and a page asking for too many).
const MAX_MAPPINGS: usize = 24;
/// How long to wait for a UPnP router to answer. Calls connect without the mapping meanwhile.
const UPNP_SEARCH_TIMEOUT: Duration = Duration::from_secs(2);
/// After finding no router, how long to wait before looking again, so each new peer does not wait for nothing.
const RETRY_DISCOVERY: Duration = Duration::from_secs(60);
const DESCRIPTION: &str = "Orvo call";

const PCP_TIMEOUTS: TimeoutConfig = TimeoutConfig {
    initial_timeout: Duration::from_millis(250),
    max_retries: 2,
    max_retry_timeout: Some(Duration::from_secs(1)),
};

/// What the page needs to build the extra candidate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappedPort {
    pub external_ip: String,
    pub external_port: u16,
    /// `upnp`, `pcp` or `nat-pmp`, for logs.
    pub method: &'static str,
}

/// A granted mapping, in the form needed to renew and remove it.
enum Lease {
    Upnp {
        gateway: Gateway<Tokio>,
        local: SocketAddrV4,
        external_port: u16,
        seconds: u32,
    },
    Pcp(PortMapping),
}

impl Lease {
    /// When to renew next; `None` for a permanent mapping, which needs no renewal.
    fn renew_after(&self) -> Option<Duration> {
        let seconds = match self {
            Lease::Upnp { seconds, .. } => *seconds,
            Lease::Pcp(mapping) => mapping.lifetime(),
        };
        (seconds > 0).then(|| Duration::from_secs(u64::from(seconds / 2).max(30)))
    }

    async fn renew(&mut self) -> bool {
        match self {
            Lease::Upnp {
                gateway,
                local,
                external_port,
                seconds,
            } => gateway
                .add_port(
                    PortMappingProtocol::UDP,
                    *external_port,
                    SocketAddr::V4(*local),
                    *seconds,
                    DESCRIPTION,
                )
                .await
                .is_ok(),
            Lease::Pcp(mapping) => mapping.renew().await.is_ok(),
        }
    }

    async fn remove(self) {
        match self {
            Lease::Upnp {
                gateway,
                external_port,
                ..
            } => {
                let _ = gateway
                    .remove_port(PortMappingProtocol::UDP, external_port)
                    .await;
            }
            Lease::Pcp(mapping) => {
                let _ = mapping.try_drop().await;
            }
        }
    }
}

struct Held {
    mapped: MappedPort,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct State {
    held: HashMap<SocketAddrV4, Held>,
    /// The UPnP router found for a local address, reused for later mappings.
    gateway: Option<(Ipv4Addr, Gateway<Tokio>)>,
    /// A local address for which no router answered at all, and when to look again.
    nothing_until: Option<(Ipv4Addr, Instant)>,
}

/// The app's port mappings. Calls are serialized, which keeps discovery to one search at a time and rules out two
/// mappings for the same port.
#[derive(Default)]
pub struct PortMapper {
    state: Mutex<State>,
    /// Where UPnP searches are sent; only tests change it.
    search_target: Option<SocketAddr>,
}

impl PortMapper {
    pub async fn map(&self, local_ip: &str, local_port: u16) -> Result<MappedPort, String> {
        self.map_local(local_address(local_ip, local_port)?).await
    }

    async fn map_local(&self, local: SocketAddrV4) -> Result<MappedPort, String> {
        let mut state = self.state.lock().await;
        if let Some(held) = state.held.get(&local) {
            return Ok(held.mapped.clone());
        }
        if state.held.len() >= MAX_MAPPINGS {
            return Err("too many port mappings".into());
        }
        if let Some((ip, until)) = state.nothing_until {
            if ip == *local.ip() && Instant::now() < until {
                return Err("no router that maps ports was found".into());
            }
        }

        let (lease, mapped) = match self.map_upnp(&mut state, local).await {
            Ok(found) => found,
            Err(upnp) => match map_pcp(local).await {
                Ok(found) => found,
                Err(pcp) => {
                    state.nothing_until = Some((*local.ip(), Instant::now() + RETRY_DISCOVERY));
                    return Err(format!("UPnP: {upnp}; PCP/NAT-PMP: {pcp}"));
                }
            },
        };
        state.nothing_until = None;
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(hold(lease, stopped));
        state.held.insert(
            local,
            Held {
                mapped: mapped.clone(),
                stop,
                task,
            },
        );
        Ok(mapped)
    }

    /// Removes the mapping for this local port, if there is one. Waits until the router has been told.
    pub async fn unmap(&self, local_ip: &str, local_port: u16) -> Result<(), String> {
        let ip: Ipv4Addr = local_ip
            .parse()
            .map_err(|_| "not an IPv4 address".to_string())?;
        let held = self
            .state
            .lock()
            .await
            .held
            .remove(&SocketAddrV4::new(ip, local_port));
        if let Some(held) = held {
            release(held).await;
        }
        Ok(())
    }

    /// Removes every mapping; for when the app exits.
    pub async fn unmap_all(&self) {
        let held: Vec<Held> = self
            .state
            .lock()
            .await
            .held
            .drain()
            .map(|(_, h)| h)
            .collect();
        for h in held {
            release(h).await;
        }
    }

    async fn map_upnp(
        &self,
        state: &mut State,
        local: SocketAddrV4,
    ) -> Result<(Lease, MappedPort), String> {
        let gateway = match &state.gateway {
            Some((ip, gateway)) if ip == local.ip() => gateway.clone(),
            _ => {
                let mut options = SearchOptions::default();
                options.bind_addr = SocketAddr::new(IpAddr::V4(*local.ip()), 0);
                options.timeout = Some(UPNP_SEARCH_TIMEOUT);
                options.single_search_timeout = Some(UPNP_SEARCH_TIMEOUT);
                options.gateway_ip_version = GatewayIpVersion::V4;
                if let Some(target) = self.search_target {
                    options.broadcast_address = target;
                    options.allowed_gateway_ips = vec![target.ip()];
                }
                let gateway = search_gateway(options)
                    .await
                    .map_err(|e| format!("no router answered ({e})"))?;
                state.gateway = Some((*local.ip(), gateway.clone()));
                gateway
            }
        };
        let result = upnp_lease(gateway, local).await;
        if result.is_err() {
            // The router may have changed or restarted; look for it afresh next time.
            state.gateway = None;
        }
        result
    }
}

async fn upnp_lease(
    gateway: Gateway<Tokio>,
    local: SocketAddrV4,
) -> Result<(Lease, MappedPort), String> {
    let external_ip = match gateway.get_external_ip().await.map_err(|e| e.to_string())? {
        IpAddr::V4(ip) => ip,
        IpAddr::V6(_) => return Err("the router reported an IPv6 address".into()),
    };
    check_public(external_ip)?;
    let (external_port, seconds) = upnp_add(&gateway, local).await?;
    let mapped = MappedPort {
        external_ip: external_ip.to_string(),
        external_port,
        method: "upnp",
    };
    Ok((
        Lease::Upnp {
            gateway,
            local,
            external_port,
            seconds,
        },
        mapped,
    ))
}

/// Asks for the same port outside as inside, else any port; with a lease, else permanently if that is all the router
/// supports.
async fn upnp_add(gateway: &Gateway<Tokio>, local: SocketAddrV4) -> Result<(u16, u32), String> {
    let addr = SocketAddr::V4(local);
    for seconds in [LEASE_SECONDS, 0] {
        match gateway
            .add_port(
                PortMappingProtocol::UDP,
                local.port(),
                addr,
                seconds,
                DESCRIPTION,
            )
            .await
        {
            Ok(()) => return Ok((local.port(), seconds)),
            Err(AddPortError::OnlyPermanentLeasesSupported) => continue,
            Err(AddPortError::PortInUse) => {
                match gateway
                    .add_any_port(PortMappingProtocol::UDP, addr, seconds, DESCRIPTION)
                    .await
                {
                    Ok(port) => return Ok((port, seconds)),
                    Err(AddAnyPortError::OnlyPermanentLeasesSupported) => continue,
                    Err(e) => return Err(e.to_string()),
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("the router refused the mapping".into())
}

async fn map_pcp(local: SocketAddrV4) -> Result<(Lease, MappedPort), String> {
    let gateway = netdev::get_default_gateway()
        .ok()
        .and_then(|device| device.ipv4.first().copied())
        .ok_or("no default gateway")?;
    let port = NonZeroU16::new(local.port()).ok_or("port 0")?;
    let options = PortMappingOptions {
        external_port: Some(port),
        lifetime_seconds: Some(LEASE_SECONDS),
        timeout_config: Some(PCP_TIMEOUTS),
    };
    let mapping = PortMapping::new(
        gateway.into(),
        IpAddr::V4(*local.ip()),
        InternetProtocol::Udp,
        port,
        options,
    )
    .await
    .map_err(|e| format!("{e:?}"))?;
    let (external_ip, method) = match mapping.mapping_type() {
        PortMappingType::Pcp {
            external_ip: IpAddr::V4(ip),
            ..
        } => (Ok(ip), "pcp"),
        PortMappingType::Pcp { .. } => (
            Err("the router reported an IPv6 address".to_string()),
            "pcp",
        ),
        PortMappingType::NatPmp => (
            natpmp::external_address(gateway.into(), Some(PCP_TIMEOUTS))
                .await
                .map_err(|e| format!("{e:?}")),
            "nat-pmp",
        ),
    };
    match external_ip.and_then(|ip| check_public(ip).map(|()| ip)) {
        Ok(ip) => {
            let mapped = MappedPort {
                external_ip: ip.to_string(),
                external_port: mapping.external_port().get(),
                method,
            };
            Ok((Lease::Pcp(mapping), mapped))
        }
        Err(e) => {
            let _ = mapping.try_drop().await;
            Err(e)
        }
    }
}

/// Keeps a mapping alive until told to stop, then removes it.
async fn hold(mut lease: Lease, mut stop: oneshot::Receiver<()>) {
    let mut wait = lease.renew_after();
    loop {
        let renew = async {
            match wait {
                Some(after) => tokio::time::sleep(after).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            _ = &mut stop => break,
            () = renew => wait = if lease.renew().await { lease.renew_after() } else { Some(RETRY_RENEW) },
        }
    }
    lease.remove().await;
}

async fn release(held: Held) {
    let _ = held.stop.send(());
    let _ = held.task.await;
}

/// The page may only map a port to this machine, and only on a private address, which is what sits behind a home
/// router. Binding to the address proves it is one of ours: a page must not open ports to other devices on the network.
fn local_address(ip: &str, port: u16) -> Result<SocketAddrV4, String> {
    let ip: Ipv4Addr = ip.parse().map_err(|_| "not an IPv4 address".to_string())?;
    if !ip.is_private() {
        return Err("not a private address".into());
    }
    if port < 1024 {
        return Err("not an ephemeral port".into());
    }
    std::net::UdpSocket::bind((ip, 0)).map_err(|_| "not an address of this device".to_string())?;
    Ok(SocketAddrV4::new(ip, port))
}

/// A router whose own outside address is private sits behind another NAT (often the ISP's), so a mapping on it would
/// still not be reachable from the internet.
fn check_public(ip: Ipv4Addr) -> Result<(), String> {
    let shared = ip.octets()[0] == 100 && (ip.octets()[1] & 0xC0) == 64; // 100.64.0.0/10, carrier-grade NAT
    if ip.is_private()
        || shared
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
    {
        return Err(format!(
            "the router is behind another NAT (its address is {ip})"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
