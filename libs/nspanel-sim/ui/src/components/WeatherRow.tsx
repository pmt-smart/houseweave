// `weather-row`, dispatched to the theme in force. The drawings live in
// `themes/<id>/WeatherRow.tsx`.
import { useComponent } from "../registry";
import type { WeatherRowProps } from "../contracts";

export type { WeatherRowProps } from "../contracts";

export function WeatherRow(props: WeatherRowProps) {
  const Impl = useComponent("weather-row");
  return Impl ? <Impl {...props} /> : null;
}
