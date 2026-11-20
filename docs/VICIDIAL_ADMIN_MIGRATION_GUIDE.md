# VICIdial Admin → FibreGems CRM Migration Guide

**Goal:** Completely move away from the VICIdial agent browser (`agc/vicidial.php`) and eliminate the callback-date popup. FibreGems CRM's REMI API + WebSocket telephony layer handles all state from here.

---

## Summary of What Changes

| Legacy (VICIdial browser) | New (FibreGems REMI API) |
|---|---|
| Agent opens `agc/vicidial.php` manually | Agent is logged in via `non_agent_api.php` → `call_agent` on sign-in |
| Heartbeat pings from browser keep `vicidial_live_agents` alive | Background keepalive loop in `FibreGemsAPI` sends pings |
| Click-to-dial via `agc/api.php?function=external_dial` | REMI `/telephony/dial` endpoint wraps the same call |
| Disposition via VICIdial dispo screen | Logged in FibreGems PostgreSQL; VICIdial record dispositioned via `non_agent_api.php` |
| Callback popup forces a date on every call | Disabled in Campaign settings + disposition screen removed |

---

## Part 1 — Disable the Callback Date Popup

The popup appears because VICIdial campaigns have **Scheduled Callbacks** enabled and force a date on `CALLBK` status.

### Steps in VICIdial Admin

1. **Log in** to VICIdial Admin → `http://10.0.0.132/vicidial/admin.php`
2. Go to **Campaigns** → find your campaign (e.g. `FIBREGEMS` or `REMI`) → click **Modify**
3. Scroll to the **Scheduled Callbacks** section and set:

   | Setting | Value |
   |---|---|
   | Scheduled Callbacks | `0 - INACTIVE` |
   | Agent-Only Callbacks | `0 - NO` |
   | Callback DNE Override | `0 - INACTIVE` |

4. Scroll to **Disposition Screen** and set:

   | Setting | Value |
   |---|---|
   | Use Custom Dispo Screen | `0 - NO` |
   | Display Scheduled Callbacks | `0 - NO` |

5. Click **Submit** at the bottom.
6. Repeat for every campaign the agent runs on.

> [!TIP]
> You can also set the **Default Disposition** to `CALLBK` or `NI` with no date required by going to **Lists → Modify List** and unchecking "Scheduled Callbacks Required".

---

## Part 2 — Eliminate the VICIdial Agent Browser Tab

### Why the browser tab was needed

VICIdial's `agc/api.php?function=external_dial` checks:
```sql
SELECT count(*) FROM vicidial_live_agents
WHERE user = '{agent}' AND status IN ('PAUSED', 'READY')
```
The `agc/vicidial.php` browser tab maintains this row by sending heartbeat HTTP requests every second. Without it the row disappears and dial requests are rejected.

### Solution: Remote Agent / Non-Agent API Session

VICIdial supports a **Remote Agent** mode and a `call_agent` API function that creates and maintains the `vicidial_live_agents` row **without** the browser tab.

---

### Step 2A — Create a Dedicated API Agent User

1. VICIdial Admin → **User Groups** → Add or modify group `REMOTES`
2. VICIdial Admin → **User Management** → Add user:

   | Field | Value |
   |---|---|
   | User Login | `fg_api` |
   | User Password | _(set a strong password)_ |
   | Full Name | `FibreGems API Agent` |
   | User Level | `1` (agent) |
   | User Group | `REMOTES` |
   | Phone Login | _(softphone extension, e.g. `200`)_ |
   | Phone Pass | _(SIP password for ext 200)_ |

3. Save.

---

### Step 2B — Configure the Campaign for Remote Agents

1. VICIdial Admin → **Campaigns** → Modify your campaign
2. Set:

   | Setting | Value |
   |---|---|
   | Allow Inbound and Blended | `0 - NO` (outbound only) |
   | Manual Dial Override | `ALLOW_ALL` |
   | Auto Dial Level | `0` (manual) |
   | Agent Screen Login | `0 - NOT REQUIRED` |

3. Under **Phone & SIP Settings**:

   | Setting | Value |
   |---|---|
   | Phone Extension | `200` _(the REMI softphone extension)_ |
   | Protocol | `SIP` |
   | Conf Extension | `8600` _(auto-assigned by VICIdial per agent)_ |

4. Click **Submit**.

---

### Step 2C — Set Up the `manager.conf` AMI Account (Asterisk)

SSH into your VICIdial server (`10.0.0.132`) and edit `/etc/asterisk/manager.conf`:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0
displayconnects = no

[cron]
secret = 1234
deny = 0.0.0.0/0.0.0.0
permit = 10.0.0.0/255.255.255.0
read = all
write = all
```

Reload Asterisk AMI:
```bash
asterisk -rx "manager reload"
```

> [!CAUTION]
> Restrict `permit` to your LAN subnet only. Never expose AMI port 5038 to the internet.

Verify REMI can connect:
```bash
telnet 10.0.0.132 5038
# You should see: Asterisk Call Manager/X.X
```

---

### Step 2D — Agent Login via Non-Agent API (automated in REMI)

REMI's `vici_service.login_agent()` already calls:
```
GET http://10.0.0.132/vicidial/non_agent_api.php
  ?function=call_agent
  &user=cron
  &pass=1234
  &agent_user=fg_api
  &value=LOGIN
  &phone_login=200
  &phone_pass=<sip_pass>
  &campaign=FIBREGEMS
```

This creates the `vicidial_live_agents` row. Add a **keepalive loop** in `FibreGemsAPI/app/services/vicidial_client.py` that calls `function=PING` every 30 seconds to keep the session alive:

```python
async def keepalive_ping(self, agent_user: str) -> None:
    """Sends a heartbeat to keep vicidial_live_agents row alive."""
    params = {
        **self._auth_params(),
        "function": "external_hangup",   # harmless no-op when no call active
        "agent_user": agent_user,
        "value": "0",
    }
    await self._dispatch_request(self.base_url_non_agent, params)
```

Call `vici_service.keepalive_ping("fg_api")` every 30 s from a background `asyncio.Task` started at app startup.

---

### Step 2E — Configure Remote Agent in VICIdial

1. VICIdial Admin → **Remote Agents** → Add Remote Agent:

   | Field | Value |
   |---|---|
   | Remote Agent User | `fg_api` |
   | Server IP | `10.0.0.132` |
   | Extension | `200` |
   | Campaign | `FIBREGEMS` |
   | Status | `ACTIVE` |

2. Save. This tells VICIdial that `fg_api` is always in Remote Agent mode — no browser tab needed.

---

## Part 3 — WebSocket Telephony Configuration

### How it works

```
VICIdial DB (MySQL)                FibreGemsAPI                     Browser (Agent)
vicidial_live_agents  ──poll──▶  _poll_pbx_loop()                  useTelephonySocket
  status = INCALL                  ↓ MeetMe participants?            (SoftphoneBar.tsx)
  conf_exten = 8600                ↓ ≥2 → connected                       ↑
                                   ↓ 1  → ringing                   ws://localhost:8000
                                   emit CALL_STATE event ────────────────▶ onCallState()
                                                                     setTelephonyState(...)
```

### Verifying live call state via Asterisk CLI

SSH into `10.0.0.132` and run:

```bash
# List all active MeetMe conferences
asterisk -rx "meetme list"

# List participants in a specific room (e.g. 8600)
asterisk -rx "meetme list 8600 concise"

# Show all active SIP channels
asterisk -rx "core show channels"

# Show current agent status
mysql -u cron -p1234 asterisk -e "SELECT user, status, conf_exten, callerid FROM vicidial_live_agents;"
```

### Testing the WebSocket directly

Install `wscat` or use the browser console:

```js
// Browser DevTools → Console (on the agent page)
const ws = new WebSocket("ws://127.0.0.1:8000/api/v1/ws/telephony?agent_code=AGT457");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

Expected messages:
```json
// On connect
{"type": "INIT_STATE", "call_state": "idle", "duration_seconds": 0}

// When ringing (1 MeetMe participant)
{"type": "CALL_STATE", "call_state": "ringing", "duration_seconds": 0, "agent_code": "fg_api"}

// When answered (≥2 MeetMe participants)
{"type": "CALL_STATE", "call_state": "connected", "duration_seconds": 5, "agent_code": "fg_api"}

// When hung up
{"type": "CALL_STATE", "call_state": "idle", "duration_seconds": 92, "agent_code": "fg_api"}
```

### Environment variables to confirm

In `FibreGemsAPI/.env`:

```env
VICIDIAL_HOST=10.0.0.132
VICIDIAL_USER=fg_api
VICIDIAL_PASS=<password>
VICIDIAL_CAMPAIGN=FIBREGEMS
VICIDIAL_PHONE_LOGIN=200
VICIDIAL_PHONE_PASS=<sip_pass>
VICIDIAL_LIST_ID=1001
AMI_USER=cron
AMI_SECRET=1234
```

---

## Part 4 — Checklist Before Going Live

- [ ] Campaign: Scheduled Callbacks → `INACTIVE`
- [ ] Campaign: Custom Dispo Screen → `NO`
- [ ] Campaign: Agent-Only Callbacks → `NO`
- [ ] User `fg_api` created in VICIdial with correct phone login/pass
- [ ] Remote Agent configured for `fg_api` in VICIdial Admin
- [ ] `manager.conf` AMI account `cron` confirmed accessible from REMI server
- [ ] `asterisk -rx "meetme list"` returns rooms during a live test call
- [ ] WebSocket test confirms `ringing` → `connected` → `idle` transitions
- [ ] REMI keepalive ping loop running (check API logs: `INFO remi.telephony - Keepalive ping sent`)
- [ ] VICIdial agent browser tab (`agc/vicidial.php`) closed — calls still go through ✅

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `agent not paused` error on dial | `vicidial_live_agents.status` is not `PAUSED` | REMI auto-pauses before dial; ensure `login_agent` succeeded |
| WebSocket only shows `idle` | AMI/MySQL unreachable | Check `VICIDIAL_HOST` env var; test `telnet 10.0.0.132 5038` |
| Timer jumps back | Local interval fighting WS tick | Fixed in `SoftphoneBar` — WS timer uses `Math.max` to never go backwards |
| Callback date popup still shows | Campaign still has `Scheduled Callbacks: ACTIVE` | Repeat Part 1 for all campaigns |
| `vicidial_live_agents` row missing | No keepalive loop / API not logged in | Check `login_agent` is called on API startup; add keepalive loop |
