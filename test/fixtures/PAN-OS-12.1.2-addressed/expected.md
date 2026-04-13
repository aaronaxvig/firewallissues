---
type: Addressed
product: PAN-OS
version: 12.1.2
---

## PAN-242777

Fixed an issue where users previously reported limitations due to session count caps when utilizing **Web Proxy** features on PA-5400 Series Firewalls. To address these performance complaints and support higher traffic volumes, we have increased the maximum session capacity on specific **PA-5400F** series platforms, leveraging available system memory. This update ensures greater capacity and stability for high-volume environments.

The supported session limits are:

| Platform | Max Sessions |
| -------- | ------------ |
| PA-5410  | 95K          |
| PA-5420  | 95K          |
| PA-5430  | 95K          |
| PA-5440  | 225K         |
| PA-5445  | 250K         |
| PA-5450  | 1.28M        |

## PAN-291499

```caveat
VM-Series firewalls on Amazon Web Services (AWS) environments only
```

Fixed an issue where newly deployed firewalls were unable to connect to the Strata Logging Service (SLS) until after a reboot, license fetch, or management server restart.

## PAN-288726

Fixed an issue where the useridd process stopped responding due to a Security policy rule ID being set to 0, which caused the last configuration retrieval to fail.

## PAN-287133

Fixed an issue on the Panorama web interface where assigning a policy rule to a group at the top or bottom of the list changed the order of other policy rules.
