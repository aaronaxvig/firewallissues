---
type: Known
product: Prisma Access Agent
version: 26.1
---

## PANG-11201

```resolved
Resolved in Prisma Access Agent 26.1.1
```

On Prisma Access Agents for Linux, when NetworkManager is configured not to manage the tunnel interface, the Prisma Access Agent connection profile becomes stuck in an "activating" state, resulting in a tunnel connect and disconnect loop that prevents successful establishment of the tunnel.

## PANG-11153

```resolved
Resolved in Prisma Access Agent 26.1.1
```

On Linux, the Prisma Access Agent may experience recurring PASrv process crashes approximately every 20 seconds due to abnormal termination, causing the agent to become unresponsive and preventing log collection. This issue occurs primarily during agent upgrade operations.

## PANG-10947

When Prisma Access Agent is configured in on-demand mode on Arch Linux and the network connection is interrupted and then restored, the agent fails to automatically reconnect to the gateway. As a result, the agent remains in a disconnected state.

## PANG-10865

On Prisma Access Agent for Linux systems, the Prisma Access Agent user interface exhibits minor cosmetic and usability inconsistencies. The Location list lacks a line separator between entries and is not sorted alphabetically, with the exception of the "Best Location" option.

## PANG-10801

During a Host Information Profile (HIP) check on Prisma Access Agent for Linux, the system incorrectly validates certificates based solely on the issuer's Common Name (CN). This results in expired or revoked certificates being considered valid if their issuer's CN matches the configured criteria, potentially allowing non-compliant endpoints to pass HIP checks.

## PANG-10668

After upgrading to Prisma Access Agent version 26.1.0.25 on Arch Linux with KDE Plasma desktop environments, the settings page in the Prisma Access Agent app might appear partially blank when the operating system's dark theme is enabled. This prevents the display of relevant information on the settings page.

## PANG-9501

When using Prisma Access Agent on a system running Fedora 42 (GNOME), running the `pacli traffic log <n>` command does not show the log details.

## PANG-9196

When Prisma Access Agent is installed on a Linux virtual machine (VM) running on an ESXi host, and the VM undergoes network changes (such as connecting or disconnecting from gateways) or experiences a sleep/wake cycle, the entire VM and the ESXi host might become unresponsive. Access to the ESXi host is lost, and the system hangs for approximately 5 minutes before access is regained.
