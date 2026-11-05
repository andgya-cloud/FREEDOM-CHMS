# Organization heads and staff

Everyone signs in on the same page and lands in the organizations their account allows.

| Role | Sees | Can add accounts |
| --- | --- | --- |
| Admin (pastor) | Everything, all organizations, money | Any account |
| Organization head | Their own organization only: people, attendance, programs, follow-ups. No money. | Staff, for their own organization only |
| Staff | Their own organization only, same work as the head. No money. | None |

- The head and staff roles are created automatically (bootstrap, or the first time an admin opens an account form).
- Money (gifts, funds, invoices, fee balances, receipts, ledger) needs `gifts.write`, `finance.reports` or `giving.person.read`; neither role has them, and the database rules refuse them.
- Heads manage staff in Settings → Staff accounts. The `listTeam` function lists only Staff accounts whose organizations are all the head's own. `createUser`, `updateUser` and `resetUserPassword` check the same rule (`canManageTeamAccount`), force the Staff role, and refuse "All organizations" or extra permissions.
- To make a head: as admin, Settings → Staff accounts → Add, role "Organization head", tick only their organization.
