# SiemMonkey is now ApePatrol

ApePatrol continues the SiemMonkey project under a new name. The rename reflects a major architectural redesign, Firefox-first development and a broader focus on analyst investigation workflows in MaxPatrol SIEM.

The product name, package, Firefox identity, UI, release artifacts and active code namespaces now use ApePatrol. The icon retains the ape lineage and adds fire and shield motifs for Firefox-first security work.

Existing settings structures remain compatible. On startup, ApePatrol migrates `siemMonkeySettings` to `apePatrolSettings` and local `siemMonkeySecrets` to `apePatrolSecrets`, preserving instances, features, providers, filters, aliases and API keys.

The Firefox ID is now `apepatrol@isaiandco.local` and must remain stable after the first Mozilla signature. An already installed build with a different Firefox ID is a distinct extension at the browser level; export/import or the same signed upgrade identity is required to move its profile data.

ApePatrol is an independent open-source project and is not affiliated with, endorsed by, or an official component of Positive Technologies.
