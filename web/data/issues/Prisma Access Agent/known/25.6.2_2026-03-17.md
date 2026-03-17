---
type: Known
product: Prisma Access Agent
version: 25.6.2
---

## PANG-9739

An issue exists where Prisma Access Agent portal (LDAP) authentication on Strata Cloud Manager requires the use of certificates from the **Global** configuration scope exclusively for cookie encryption and decryption operations.

When configuring portal authentication for Prisma Access Agent, you must select certificates from the **Global** scope (**NGFW and Prisma Access** > **Configuration Scope** > **Global** > **Objects** > **Certificate Management**) for this purpose and must avoid using certificates that share the same name across different scopes.

Specifically, if a certificate is selected from the **Global** scope for portal authentication, you must verify that no certificate with an identical name exists under the **Prisma Access** or **Access Agent** scopes, as any naming conflict can cause authentication issues. This scope restriction is necessary to prevent certificate conflicts and ensure proper cookie handling during the LDAP authentication process for Prisma Access Agent users.
