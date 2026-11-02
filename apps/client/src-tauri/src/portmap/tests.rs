use super::*;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};

const ROUTER_PUBLIC_IP: &str = "203.0.113.7";

/// How the fake router behaves, and what it has been asked to do.
#[derive(Default)]
struct Router {
    external_ip: Option<&'static str>,
    permanent_only: bool,
    taken_ports: Vec<u16>,
    /// External port to (internal port, lease seconds).
    mappings: HashMap<u16, (u16, u32)>,
    removed: Vec<u16>,
}

/// A UPnP internet gateway on loopback: answers the SSDP search, serves its description and service schema, and
/// handles the SOAP actions the mapper uses.
async fn fake_router(router: Router) -> (SocketAddr, Arc<StdMutex<Router>>) {
    let router = Arc::new(StdMutex::new(router));
    let http = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let http_port = http.local_addr().unwrap().port();
    let ssdp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let ssdp_addr = ssdp.local_addr().unwrap();

    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        while let Ok((_, from)) = ssdp.recv_from(&mut buf).await {
            let reply = format!(
                "HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:{http_port}/desc.xml\r\n\r\n"
            );
            let _ = ssdp.send_to(reply.as_bytes(), from).await;
        }
    });

    let state = router.clone();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = http.accept().await {
            let state = state.clone();
            tokio::spawn(async move {
                let request = read_request(&mut stream).await;
                let body = respond(&request, &mut state.lock().unwrap());
                let reply = format!(
                    "HTTP/1.1 {}\r\nContent-Type: text/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    if body.contains("<s:Fault>") { "500 Internal Server Error" } else { "200 OK" },
                    body.len(),
                    body
                );
                let _ = stream.write_all(reply.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    (ssdp_addr, router)
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
    let mut data = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = stream.read(&mut buf).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        let text = String::from_utf8_lossy(&data);
        if let Some(end) = text.find("\r\n\r\n") {
            let length = text[..end]
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            if data.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8_lossy(&data).into_owned()
}

fn field(request: &str, name: &str) -> Option<String> {
    let start = request.find(&format!("<{name}>"))? + name.len() + 2;
    let end = request[start..].find(&format!("</{name}>"))? + start;
    Some(request[start..end].to_string())
}

const SERVICE: &str = "urn:schemas-upnp-org:service:WANIPConnection:1";

fn respond(request: &str, router: &mut Router) -> String {
    if request.starts_with("GET /desc.xml") {
        return format!(
            r#"<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><deviceList><device>
<deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device>
<deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><serviceList><service>
<serviceType>{SERVICE}</serviceType><controlURL>/ctl</controlURL><SCPDURL>/scpd.xml</SCPDURL>
</service></serviceList></device></deviceList></device></deviceList></device></root>"#
        );
    }
    if request.starts_with("GET /scpd.xml") {
        let action = |name: &str, args: &[&str]| {
            let args: String = args
                .iter()
                .map(|a| format!("<argument><name>{a}</name><direction>in</direction></argument>"))
                .collect();
            format!("<action><name>{name}</name><argumentList>{args}</argumentList></action>")
        };
        let add = [
            "NewRemoteHost",
            "NewExternalPort",
            "NewProtocol",
            "NewInternalPort",
            "NewInternalClient",
            "NewEnabled",
            "NewPortMappingDescription",
            "NewLeaseDuration",
        ];
        return format!(
            r#"<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><actionList>{}{}{}</actionList></scpd>"#,
            action("GetExternalIPAddress", &[]),
            action("AddPortMapping", &add),
            action(
                "DeletePortMapping",
                &["NewRemoteHost", "NewExternalPort", "NewProtocol"]
            ),
        );
    }
    let envelope = |inner: String| {
        format!(
            r#"<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>{inner}</s:Body></s:Envelope>"#
        )
    };
    let fault = |code: u16| {
        envelope(format!(
            r#"<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>{code}</errorCode><errorDescription>error</errorDescription></UPnPError></detail></s:Fault>"#
        ))
    };
    if request.contains("#GetExternalIPAddress") {
        let ip = router.external_ip.unwrap_or(ROUTER_PUBLIC_IP);
        return envelope(format!(
            r#"<u:GetExternalIPAddressResponse xmlns:u="{SERVICE}"><NewExternalIPAddress>{ip}</NewExternalIPAddress></u:GetExternalIPAddressResponse>"#
        ));
    }
    if request.contains("#AddPortMapping") {
        let external: u16 = field(request, "NewExternalPort").unwrap().parse().unwrap();
        let internal: u16 = field(request, "NewInternalPort").unwrap().parse().unwrap();
        let lease: u32 = field(request, "NewLeaseDuration").unwrap().parse().unwrap();
        if router.permanent_only && lease != 0 {
            return fault(725);
        }
        if router.taken_ports.contains(&external) {
            return fault(718);
        }
        router.mappings.insert(external, (internal, lease));
        return envelope(format!(
            r#"<u:AddPortMappingResponse xmlns:u="{SERVICE}"/>"#
        ));
    }
    if request.contains("#DeletePortMapping") {
        let external: u16 = field(request, "NewExternalPort").unwrap().parse().unwrap();
        router.mappings.remove(&external);
        router.removed.push(external);
        return envelope(format!(
            r#"<u:DeletePortMappingResponse xmlns:u="{SERVICE}"/>"#
        ));
    }
    fault(401)
}

fn mapper_for(ssdp: SocketAddr) -> PortMapper {
    PortMapper {
        search_target: Some(ssdp),
        ..PortMapper::default()
    }
}

const LOCAL: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 50_000);

#[tokio::test]
async fn maps_the_same_port_with_a_lease_and_removes_it_on_release() {
    let (ssdp, router) = fake_router(Router::default()).await;
    let mapper = mapper_for(ssdp);

    let mapped = mapper.map_local(LOCAL).await.unwrap();
    assert_eq!(
        mapped,
        MappedPort {
            external_ip: ROUTER_PUBLIC_IP.into(),
            external_port: 50_000,
            method: "upnp"
        }
    );
    assert_eq!(
        router.lock().unwrap().mappings.get(&50_000),
        Some(&(50_000, LEASE_SECONDS))
    );

    mapper.unmap("127.0.0.1", 50_000).await.unwrap();
    assert!(router.lock().unwrap().mappings.is_empty());
    assert_eq!(router.lock().unwrap().removed, vec![50_000]);
}

#[tokio::test]
async fn asking_twice_for_one_port_gives_the_same_mapping() {
    let (ssdp, router) = fake_router(Router::default()).await;
    let mapper = mapper_for(ssdp);
    let first = mapper.map_local(LOCAL).await.unwrap();
    assert_eq!(mapper.map_local(LOCAL).await.unwrap(), first);
    assert_eq!(router.lock().unwrap().mappings.len(), 1);
}

#[tokio::test]
async fn falls_back_to_a_permanent_mapping_when_the_router_only_offers_those() {
    let (ssdp, router) = fake_router(Router {
        permanent_only: true,
        ..Router::default()
    })
    .await;
    let mapper = mapper_for(ssdp);
    mapper.map_local(LOCAL).await.unwrap();
    assert_eq!(
        router.lock().unwrap().mappings.get(&50_000),
        Some(&(50_000, 0))
    );
    mapper.unmap_all().await;
    assert!(router.lock().unwrap().mappings.is_empty());
}

#[tokio::test]
async fn takes_another_outside_port_when_the_same_one_is_in_use() {
    let (ssdp, router) = fake_router(Router {
        taken_ports: vec![50_000],
        ..Router::default()
    })
    .await;
    let mapper = mapper_for(ssdp);
    let mapped = mapper.map_local(LOCAL).await.unwrap();
    assert_ne!(mapped.external_port, 50_000);
    assert_eq!(
        router.lock().unwrap().mappings.get(&mapped.external_port),
        Some(&(50_000, LEASE_SECONDS))
    );
}

#[tokio::test]
async fn refuses_a_router_that_is_itself_behind_another_nat() {
    let (ssdp, router) = fake_router(Router {
        external_ip: Some("100.70.1.2"),
        ..Router::default()
    })
    .await;
    let mut options = SearchOptions::default();
    options.bind_addr = "127.0.0.1:0".parse().unwrap();
    options.broadcast_address = ssdp;
    options.allowed_gateway_ips = vec![ssdp.ip()];
    options.timeout = Some(UPNP_SEARCH_TIMEOUT);
    let gateway = search_gateway(options).await.unwrap();
    let err = upnp_lease(gateway, LOCAL).await.err().unwrap();
    assert!(err.contains("behind another NAT"), "{err}");
    assert!(router.lock().unwrap().mappings.is_empty());
}

#[test]
fn only_maps_private_addresses_of_this_device() {
    assert!(local_address("8.8.8.8", 50_000).is_err());
    assert!(local_address("127.0.0.1", 50_000).is_err());
    assert!(local_address("not an ip", 50_000).is_err());
    // A private address that belongs to some other device on the network cannot be bound, so it is refused.
    assert!(local_address("10.255.255.254", 50_000)
        .unwrap_err()
        .contains("not an address of this device"));
}

#[test]
fn tells_public_router_addresses_from_ones_behind_another_nat() {
    assert!(check_public("203.0.113.7".parse().unwrap()).is_ok());
    for ip in [
        "10.0.0.1",
        "192.168.1.1",
        "172.16.0.1",
        "100.64.0.1",
        "100.127.255.254",
        "0.0.0.0",
    ] {
        assert!(check_public(ip.parse().unwrap()).is_err(), "{ip}");
    }
    assert!(check_public("100.128.0.1".parse().unwrap()).is_ok());
}
