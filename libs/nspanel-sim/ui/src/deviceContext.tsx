// Which panel is being drawn, as context rather than as a prop.
//
// Not a `DevicePreset` in a component's props: the device is not something a
// screen SAYS, it is the panel the
// screen is on. A placement binds what the component shows -- a light, a title,
// a percentage -- and the panel underneath is the same for every placement on
// the page.
//
// It matters for more than tidiness. The minimum touch target is in millimetres
// and only the device knows how many pixels that is, so every
// component that sizes a target needs this, and none of them should be able to
// be handed the wrong one.
import { createContext, useContext, type ReactNode } from "react";
import { DEVICES, type DeviceId, type DevicePreset } from "./devices";

const DeviceContext = createContext<DevicePreset>(DEVICES["eu-landscape"]);

export function DeviceProvider({ device, children }: { device: DeviceId; children: ReactNode }) {
  return <DeviceContext.Provider value={DEVICES[device]}>{children}</DeviceContext.Provider>;
}

/** The panel in force. Outside a provider, the EU landscape unit. */
export function useDevicePreset(): DevicePreset {
  return useContext(DeviceContext);
}
