# Origin

These files are copies of code from **joBr99's NSPanel Lovelace UI**, <https://github.com/joBr99/nspanel-lovelace-ui>, read from its main
branch on 2026-08-29 (no commit was recorded then; `autoexec.be` says it is version 9 of its script). That project is licensed under the
GNU General Public License v3.0, and so are these copies: see [LICENSE](LICENSE).

- `autoexec.be`: the Berry driver that talks to the panel's Nextion screen over its serial line and flashes a `.tft`.
- `luibackend/`: the Python backend of its AppDaemon app, which speaks the screen's protocol from Home Assistant.

HouseWeave keeps them as a reference, unchanged:

- `berry/nextion_driver.be` is written from joBr99's driver: the serial framing, the flashing and its error handling;
- the screen's vocabulary that the brain speaks to joBr99's own `.tft` (`berry/brain.be`, `berry/home.be`, `berry/light.be`) was read from
  `luibackend/`, and not guessed;
- `libs/nspanel-sim/export/scripts/build-theme-fonts.mjs` reads `luibackend/icon_mapping.py` as data, for the icons of joBr99's theme.
