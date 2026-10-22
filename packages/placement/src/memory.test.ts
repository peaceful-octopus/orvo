import { MemoryPlacementStore } from './memory';
import { describeStoreContract } from './store.contract';

describeStoreContract('Memory', async () => {
  let now = 0;
  return { store: new MemoryPlacementStore([], () => now), advance: async (ms) => void (now += ms) };
});
