# ApePatrol brand

## Identity

- Product: **ApePatrol**
- Tagline: **Firefox investigation companion for MaxPatrol SIEM**
- Optional expansion: **APE — Analyst Productivity Extension**
- Package: `apepatrol`
- Firefox extension ID: `apepatrol@isaiandco.local`
- Target: Firefox Desktop 140+, Firefox Android 142+, MaxPatrol SIEM 27.3

ApePatrol is the successor to SiemMonkey. The name describes the evolution from a collection of UI monkey patches into a mature investigation companion: Monkey → Ape, with Patrol referring to observation and SOC work.

ApePatrol is an independent open-source project and is not affiliated with, endorsed by, or an official component of Positive Technologies.

## Visual system

The mascot combines an ape, a security shield and an arc of fire. Fire communicates Firefox-first development without copying Mozilla artwork. The palette uses amber, orange, red, magenta, violet and deep purple.

The transparent 1024×1024 master is stored at `assets/branding/apepatrol-master.png`. Browser-ready icons are generated in `assets/icons/` at 16, 32, 48, 64, 96, 128 and 256 pixels. Do not add text to the icon or combine it with Firefox, MaxPatrol or Positive Technologies logos.

## Transition

Version 3.0 may describe itself as “ApePatrol — successor to SiemMonkey”. `Formerly SiemMonkey` is transitional copy and must not become part of the permanent product name.

New public identifiers use ApePatrol. The previous `siemMonkeySettings` and `siemMonkeySecrets` keys remain only as one-time migration aliases; after a successful migration they are removed. The current repository slug may be changed separately because build and release update URLs derive from `GITHUB_REPOSITORY`.

## Release names

- XPI: `apepatrol-<version>-firefox.xpi`
- source archive: `apepatrol-<version>-source.zip`
- SBOM: `apepatrol-<version>-sbom.cdx.json`
- GitHub release: `ApePatrol <version>`
