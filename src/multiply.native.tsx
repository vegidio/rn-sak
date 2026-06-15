import { NitroModules } from 'react-native-nitro-modules';
import type { RnSak } from './RnSak.nitro';

const RnSakHybridObject = NitroModules.createHybridObject<RnSak>('RnSak');

export function multiply(a: number, b: number): number {
    return RnSakHybridObject.multiply(a, b);
}
