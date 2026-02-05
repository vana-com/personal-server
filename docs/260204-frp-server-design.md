# FRP Server Technical Design Document

**Status:** Draft
**Target Branch:** `feat/data-portability-v1`
**Last Updated:** 2026-02-04

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Background & Requirements](#2-background--requirements)
3. [Architecture Overview](#3-architecture-overview)
4. [Infrastructure Design](#4-infrastructure-design)
5. [FRP Server Configuration](#5-frp-server-configuration)
6. [Authentication & Security](#6-authentication--security)
7. [Personal Server Tunnel Integration](#7-personal-server-tunnel-integration)
8. [API Specification](#8-api-specification)
9. [Deployment & Operations](#9-deployment--operations)
10. [Monitoring & Observability](#10-monitoring--observability)
11. [Implementation Plan](#11-implementation-plan)
12. [Cost Estimation](#12-cost-estimation)
13. [Future Considerations](#13-future-considerations)
14. [Appendix](#appendix)

---

## 1. Executive Summary

### 1.1 Purpose

This document specifies the technical design for the Vana FRP (Fast Reverse Proxy) Server infrastructure. The FRP server enables Desktop-bundled Personal Servers to receive inbound HTTP requests from the internet, allowing builders to access user data when the Desktop App is running.

### 1.2 Key Decisions

| Decision          | Choice                                                   | Rationale                                                                                         |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Proxy Technology  | [frp](https://github.com/fatedier/frp)                   | Open-source, battle-tested, supports HTTP/HTTPS proxying with subdomain routing                   |
| Cloud Provider    | Google Cloud Platform (GCP)                              | Reliable, global infrastructure, easy integration with Cloudflare                                 |
| CDN/DNS           | Cloudflare                                               | Wildcard DNS, DDoS protection, edge TLS termination, free tier available                          |
| Compute           | GCP Compute Engine (VM)                                  | Simple, cost-effective for MVP; can migrate to GKE later                                          |
| Authentication    | Web3Signed claims + frps plugin (no shared static token) | Uses frps server plugin on Login/NewProxy with wallet/subdomain-bound claims                      |
| Hostname Topology | Split data plane and control plane hostnames             | Keeps builder HTTPS behind Cloudflare proxy while frpc control traffic uses DNS-only TCP endpoint |
| Subdomain Format  | `{walletAddress}.server.vana.org`                        | Deterministic, collision-free, aligns with protocol spec                                          |

### 1.3 Scope

**In Scope:**

- FRP server deployment and configuration
- Cloudflare DNS and TLS setup
- Web3Signed client authentication via frps plugin
- Health checking and basic monitoring
- Personal Server frpc integration specification

**Out of Scope (Future Phases):**

- Rate limiting and abuse prevention
- Multi-region deployment
- On-chain authentication verification
- Connection analytics and billing

---

## 2. Background & Requirements

### 2.1 Problem Statement

Desktop-bundled Personal Servers run on user devices behind NAT/firewalls. Builders need to send HTTP requests to these servers to access user data. Without a tunneling solution, Personal Servers are unreachable from the internet.

### 2.2 Protocol Context

From the Data Portability Protocol Spec (Section 4.1.11):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DESKTOP TUNNELING ARCHITECTURE                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  User's Desktop                                                         ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  Desktop App (Tauri)                                                │││
│  │  │  └── Personal Server (localhost:8080)                               │││
│  │  │       └── frpc daemon                                               │││
│  │  │            └── Outbound tunnel to Vana FRP server                   │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Outbound-only connection                  │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Vana FRP Server (proxy.server.vana.org + frpc.server.vana.org:7000)    ││
│  │  URL: https://{walletAddress}.server.vana.org                           ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Builder request                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Builder App                                                            ││
│  │  GET https://{walletAddress}.server.vana.org/v1/data/instagram.profile  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Requirements

#### Functional Requirements

| ID   | Requirement                                                                                     | Priority |
| ---- | ----------------------------------------------------------------------------------------------- | -------- |
| FR-1 | Route HTTP requests to `{walletAddress}.server.vana.org` to the corresponding Personal Server   | P0       |
| FR-2 | Support concurrent connections from multiple Desktop Apps                                       | P0       |
| FR-3 | Authenticate frpc clients using signed claims validated by frps plugin (no shared static token) | P0       |
| FR-4 | Provide TLS termination for all inbound HTTPS traffic                                           | P0       |
| FR-5 | Return appropriate errors when Personal Server is offline                                       | P0       |
| FR-6 | Support WebSocket connections for future MCP SSE transport                                      | P1       |

#### Non-Functional Requirements

| ID    | Requirement              | Target      |
| ----- | ------------------------ | ----------- |
| NFR-1 | Availability             | 99% (MVP)   |
| NFR-2 | Latency overhead         | < 50ms p99  |
| NFR-3 | Concurrent tunnels       | 10,000+     |
| NFR-4 | Time to establish tunnel | < 2 seconds |

### 2.4 Why FRP over Alternatives

| Aspect              | FRP                 | Cloudflare Tunnel             | ngrok             |
| ------------------- | ------------------- | ----------------------------- | ----------------- |
| Third-party account | Not required        | Required per-user             | Required per-user |
| Subdomain control   | Full control        | Random or requires CF account | Paid feature      |
| Self-hosted         | Yes                 | No                            | Enterprise only   |
| Open source         | Yes (Apache 2.0)    | No                            | No                |
| Cost                | Infrastructure only | Free tier, then paid          | Paid              |
| Custom domain       | Yes                 | Complex                       | Paid              |

FRP provides full control over the tunneling infrastructure without requiring users to create third-party accounts.

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    INTERNET                                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐│
│  │  DNS (proxied): *.server.vana.org → proxy.server.vana.org (CNAME)                    ││
│  │  DNS (dns-only): frpc.server.vana.org → <vm static ip> (A)                           ││
│  │  TLS: Wildcard certificate (*.server.vana.org)                                      ││
│  │  DDoS: Layer 3/4/7 protection                                                       ││
│  │  Mode: Full (strict) SSL/TLS                                                        ││
│  └─────────────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ HTTPS (443)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              GCP COMPUTE ENGINE                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐│
│  │  frps (FRP Server)                                                                  ││
│  │  ├── HTTPS VHost: 443 (builder traffic via Cloudflare)                              ││
│  │  ├── Control Port: 7000 (frpc control channel, DNS-only endpoint)                   ││
│  │  ├── Dashboard: 7500 (internal metrics)                                             ││
│  │  ├── Subdomain routing: {walletAddress} → tunnel connection                         ││
│  │  └── Plugin: calls Auth Plugin on Login/NewProxy operations                         ││
│  └─────────────────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐│
│  │  Auth Plugin (sidecar container)                                                    ││
│  │  ├── HTTP: 9000 (internal, localhost only)                                          ││
│  │  ├── Validates Web3Signed claims on Login                                           ││
│  │  └── Validates subdomain matches wallet on NewProxy                                 ││
│  └─────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                         │
│  External IP: 34.xxx.xxx.xxx (proxy.server.vana.org + frpc.server.vana.org)             │
│  Firewall: Allow 443 (HTTPS), 7000 (frpc), deny others                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │ TCP (7000) - frp control channel
                                         │
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              USER DEVICES                                                │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐│
│  │  Desktop App (User A)    │  │  Desktop App (User B)    │  │  Desktop App (User N)    ││
│  │  └── Personal Server     │  │  └── Personal Server     │  │  └── Personal Server     ││
│  │       (localhost:8080)   │  │       (localhost:8080)   │  │       (localhost:8080)   ││
│  │       └── frpc daemon    │  │       └── frpc daemon    │  │       └── frpc daemon    ││
│  │          subdomain: 0x.. │  │          subdomain: 0x.. │  │          subdomain: 0x.. ││
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Request Flow

```
┌─────────┐     ┌───────────┐     ┌───────────┐     ┌─────────────────────────────┐
│ Builder │     │Cloudflare │     │ frps      │     │ Personal Server             │
│   App   │     │   Edge    │     │ (GCP)     │     │ (frpc + localhost:8080)     │
└────┬────┘     └─────┬─────┘     └─────┬─────┘     └──────────────┬──────────────┘
     │                │                 │                          │
     │ 1. GET https://0xABC.server.vana.org/v1/data/instagram.profile
     │───────────────▶│                 │                          │
     │                │                 │                          │
     │                │ 2. DNS resolve  │                          │
     │                │    + TLS term   │                          │
     │                │────────────────▶│                          │
     │                │                 │                          │
     │                │                 │ 3. Route by subdomain    │
     │                │                 │    "0xABC" → frpc tunnel │
     │                │                 │─────────────────────────▶│
     │                │                 │                          │
     │                │                 │       4. frpc forwards   │
     │                │                 │          to localhost,   │
     │                │                 │          server processes│
     │                │                 │          (verify grant,  │
     │                │                 │           return data)   │
     │                │                 │◀─────────────────────────│
     │                │                 │                          │
     │                │◀────────────────│                          │
     │                │                 │                          │
     │◀───────────────│                 │                          │
     │                │                 │                          │
     │ 5. Response    │                 │                          │
     │    { data }    │                 │                          │
     │                │                 │                          │
```

### 3.3 Tunnel Establishment Flow

```
┌─────────────────┐                    ┌─────────────────┐     ┌─────────────────┐
│ Personal Server │                    │  frps           │     │  Auth Plugin    │
│ + frpc          │                    │                 │     │  (sidecar)      │
└────────┬────────┘                    └────────┬────────┘     └────────┬────────┘
         │                                      │                       │
         │ 1. User opens Desktop App            │                       │
         │    Personal Server starts            │                       │
         │                                      │                       │
         │ 2. Personal Server generates         │                       │
         │    Web3Signed claim (signs with      │                       │
         │    server keypair)                   │                       │
         │                                      │                       │
         │ 3. frpc connects to frps             │                       │
         │    metas.auth_claim/auth_sig         │                       │
         │    metas.wallet: "0xABC..."          │                       │
         │─────────────────────────────────────▶│                       │
         │                                      │                       │
         │                                      │ 4. POST /handler?op=Login
         │                                      │──────────────────────▶│
         │                                      │                       │
         │                                      │ 5. Validate signature │
         │                                      │    Check delegation   │
         │                                      │    (Gateway lookup)   │
         │                                      │◀──────────────────────│
         │                                      │    { reject: false }  │
         │                                      │                       │
         │ 6. frpc registers proxy              │                       │
         │    subdomain: "0xabc..."             │                       │
         │─────────────────────────────────────▶│                       │
         │                                      │                       │
         │                                      │ 7. POST /handler?op=NewProxy
         │                                      │──────────────────────▶│
         │                                      │                       │
         │                                      │ 8. Verify subdomain   │
         │                                      │    === wallet.lower() │
         │                                      │◀──────────────────────│
         │                                      │    { reject: false }  │
         │                                      │                       │
         │◀─────────────────────────────────────│                       │
         │    Tunnel established                │                       │
         │                                      │                       │
         │ 9. Tunnel ready at                   │                       │
         │    https://{wallet}.server.vana.org  │                       │
```

---

## 4. Infrastructure Design

### 4.1 Cloudflare Configuration

#### 4.1.1 DNS Records

| Type  | Name           | Content                 | Proxy              | TTL  | Purpose                                   |
| ----- | -------------- | ----------------------- | ------------------ | ---- | ----------------------------------------- |
| A     | `proxy.server` | `34.xxx.xxx.xxx`        | Yes (orange cloud) | Auto | Builder HTTPS data plane                  |
| CNAME | `*.server`     | `proxy.server.vana.org` | Yes (orange cloud) | Auto | Wallet subdomain routing for builders     |
| CNAME | `server`       | `proxy.server.vana.org` | Yes (orange cloud) | Auto | External health endpoint host (`/health`) |
| A     | `frpc.server`  | `34.xxx.xxx.xxx`        | No (DNS only)      | Auto | frpc TCP control plane (`:7000`)          |

**Important:** Keep `frpc.server.vana.org` DNS-only. Cloudflare proxy mode does not support arbitrary origin TCP ports like `7000` on the free/proxied path.

#### 4.1.2 SSL/TLS Settings

```yaml
# Cloudflare SSL/TLS Configuration
ssl_mode: full_strict # Validates origin certificate

# Edge Certificates
edge_certificate:
  type: universal # Free, auto-renewed
  covers:
    - "*.server.vana.org"
    - "server.vana.org"

# Origin Certificate (generated in Cloudflare dashboard)
origin_certificate:
  validity: 15 years
  hostnames:
    - "*.server.vana.org"
    - "server.vana.org"
  key_type: rsa_2048
```

#### 4.1.3 Security Settings

```yaml
# Cloudflare Security Configuration
security_level: medium
challenge_ttl: 3600

# WAF Rules (optional, can add later)
waf:
  enabled: true
  mode: simulate # Start in simulate mode

# Rate Limiting (future phase)
rate_limiting:
  enabled: false # MVP: disabled
```

### 4.2 GCP Infrastructure

#### 4.2.1 Compute Engine VM

```yaml
# Terraform-style specification
resource "google_compute_instance" "frp_server" {
  name         = "frp-server-prod"
  machine_type = "e2-medium"  # 2 vCPU, 4 GB RAM
  zone         = "us-central1-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20  # GB
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {
      # Ephemeral public IP (or reserve static IP)
    }
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Install frps, configure, start service
    # See Section 9 for full deployment script
  EOF

  tags = ["frp-server", "https-server"]

  labels = {
    environment = "production"
    service     = "frp"
  }
}
```

#### 4.2.2 Firewall Rules

```yaml
# GCP Firewall Rules
rules:
  - name: allow-https
    direction: INGRESS
    source_ranges: ["<cloudflare-ipv4-ranges-csv>"] # Populate from https://www.cloudflare.com/ips-v4
    target_tags: ["frp-server"]
    allowed:
      - protocol: tcp
        ports: [443]

  - name: allow-frpc
    direction: INGRESS
    source_ranges: ["0.0.0.0/0"] # Desktop clients are on consumer networks; keep open and enforce auth in plugin
    target_tags: ["frp-server"]
    allowed:
      - protocol: tcp
        ports: [7000]

  - name: allow-ssh-iap
    direction: INGRESS
    source_ranges: ["35.235.240.0/20"] # IAP range
    target_tags: ["frp-server"]
    allowed:
      - protocol: tcp
        ports: [22]
```

#### 4.2.3 Static IP (Optional but Recommended)

```bash
# Reserve static external IP
gcloud compute addresses create frp-server-ip \
  --region=us-central1

# Get the IP address
gcloud compute addresses describe frp-server-ip \
  --region=us-central1 \
  --format="get(address)"
```

### 4.3 Network Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Anycast Edge (200+ cities)                                             ││
│  │  ├── DNS Resolution                                                     ││
│  │  ├── TLS Termination (edge certificate)                                 ││
│  │  ├── DDoS Mitigation                                                    ││
│  │  └── HTTP/2 → HTTP/1.1 (if needed)                                      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ TLS (origin certificate)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GCP us-central1                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  VPC: default                                                           ││
│  │  ├── Firewall: 443 (HTTPS), 7000 (frpc), 22 (IAP SSH)                   ││
│  │  │                                                                      ││
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ ││
│  │  │  │  Compute Engine: frp-server-prod                                │ ││
│  │  │  │  ├── e2-medium (2 vCPU, 4 GB RAM)                               │ ││
│  │  │  │  ├── Debian 12                                                  │ ││
│  │  │  │  ├── frps process (systemd managed)                             │ ││
│  │  │  │  ├── Origin TLS certificate                                     │ ││
│  │  │  │  └── External IP: 34.xxx.xxx.xxx                                │ ││
│  │  │  └─────────────────────────────────────────────────────────────────┘ ││
│  │  │                                                                      ││
│  │  └── Cloud Logging, Cloud Monitoring                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. FRP Server Configuration

### 5.1 frps Configuration File

```toml
# /etc/frp/frps.toml

# =============================================================================
# FRP Server Configuration for Vana Personal Server Tunneling
# =============================================================================

# -----------------------------------------------------------------------------
# Server Binding
# -----------------------------------------------------------------------------
bindAddr = "0.0.0.0"
bindPort = 7000                    # frpc control connections

# -----------------------------------------------------------------------------
# HTTP/HTTPS Proxy
# -----------------------------------------------------------------------------
vhostHTTPPort = 8080                # Optional HTTP ingress (local/dev or internal debugging)
vhostHTTPSPort = 443                # Builder traffic via Cloudflare-proxied hostnames
subdomainHost = "server.vana.org"   # Base domain for subdomain routing

# -----------------------------------------------------------------------------
# Authentication (Plugin-First)
# -----------------------------------------------------------------------------
# No shared static auth token between frps and frpc.
# Authentication and authorization are enforced by the Login/NewProxy plugin.

# -----------------------------------------------------------------------------
# Dashboard (internal monitoring)
# -----------------------------------------------------------------------------
webServer.addr = "127.0.0.1"       # Localhost only
webServer.port = 7500
webServer.user = "admin"
webServer.password = "{{ DASHBOARD_PASSWORD }}"

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
log.to = "/var/log/frp/frps.log"
log.level = "info"
log.maxDays = 7

# -----------------------------------------------------------------------------
# Connection Settings
# -----------------------------------------------------------------------------
transport.maxPoolCount = 10        # Max connections per tunnel
transport.tcpMux = true            # Enable TCP multiplexing
transport.tcpMuxKeepaliveInterval = 30

# -----------------------------------------------------------------------------
# Limits (MVP: relaxed, tighten in future)
# -----------------------------------------------------------------------------
# maxPortsPerClient = 0            # 0 = unlimited
# userConnTimeout = 10             # Seconds

# -----------------------------------------------------------------------------
# Server Plugin (Auth Plugin)
# -----------------------------------------------------------------------------
[[httpPlugins]]
name = "auth-plugin"
addr = "127.0.0.1:9000"
path = "/handler"
ops = ["Login", "NewProxy"]

# -----------------------------------------------------------------------------
# TLS (origin certificate for Cloudflare Full Strict)
# -----------------------------------------------------------------------------
transport.tls.certFile = "/etc/frp/certs/server.crt"
transport.tls.keyFile = "/etc/frp/certs/server.key"
```

### 5.2 Environment Variables

```bash
# /etc/frp/frps.env
DASHBOARD_PASSWORD=<generated-secure-password>
```

### 5.3 Systemd Service

```ini
# /etc/systemd/system/frps.service
[Unit]
Description=FRP Server Service
After=network.target

[Service]
Type=simple
User=frp
Group=frp
EnvironmentFile=/etc/frp/frps.env
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
LimitNOFILE=65535

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/frp

[Install]
WantedBy=multi-user.target
```

---

## 6. Authentication & Security

### 6.1 Authentication Overview

Authentication uses **frps server plugins** — frps calls an external HTTP service (Auth Plugin) to validate client connections. This eliminates the need for a separate credential exchange step.

The Auth Plugin validates **Web3Signed** claims — the same signature scheme used across the Vana protocol (Storage Service, Personal Server, etc.).

#### 6.1.1 Authentication Flow

```
┌─────────────────┐                    ┌─────────────────┐     ┌─────────────────┐
│ Personal Server │                    │  frps           │     │  Auth Plugin    │
│ + frpc          │                    │                 │     │  (sidecar)      │
└────────┬────────┘                    └────────┬────────┘     └────────┬────────┘
         │                                      │                       │
         │ 1. frpc connects                     │                       │
         │    metas.auth_claim/auth_sig         │                       │
         │    metas.wallet: "0xABC..."          │                       │
         │─────────────────────────────────────▶│                       │
         │                                      │                       │
         │                                      │ 2. POST /handler?op=Login
         │                                      │    { metas, ... }     │
         │                                      │──────────────────────▶│
         │                                      │                       │
         │                                      │ 3. Validate Web3Signed│
         │                                      │    Check delegation   │
         │                                      │    (Gateway if needed)│
         │                                      │                       │
         │                                      │ 4. { reject: false }  │
         │                                      │◀──────────────────────│
         │                                      │                       │
         │ 5. frpc registers proxy              │                       │
         │    subdomain: "0xabc..."             │                       │
         │─────────────────────────────────────▶│                       │
         │                                      │                       │
         │                                      │ 6. POST /handler?op=NewProxy
         │                                      │    { subdomain,       │
         │                                      │      user.metas, ... }│
         │                                      │──────────────────────▶│
         │                                      │                       │
         │                                      │ 7. Verify subdomain   │
         │                                      │    === wallet.lower() │
         │                                      │                       │
         │                                      │ 8. { reject: false }  │
         │                                      │◀──────────────────────│
         │                                      │                       │
         │◀─────────────────────────────────────│                       │
         │    Tunnel established                │                       │
```

#### 6.1.2 frpc Configuration

The Personal Server configures frpc with plugin-validated metadata claims (no shared static `auth.token`):

```toml
# frpc.toml (generated by Personal Server)
serverAddr = "frpc.server.vana.org"
serverPort = 7000
loginFailExit = false  # keep retrying on transient failures (recommended for desktop uptime)

# Metadata consumed by Login/NewProxy plugin
metadatas.wallet = "0xABC1234567890abcdef1234567890abcdef1234"
metadatas.owner = "0xABC1234567890abcdef1234567890abcdef1234"
metadatas.run_id = "abc123"
metadatas.auth_claim = "{base64url(payloadJson)}"
metadatas.auth_sig = "0x{eip191Signature}"

[[proxies]]
name = "personal-server"
type = "http"
localIP = "127.0.0.1"
localPort = 8080
subdomain = "0xabc1234567890abcdef1234567890abcdef1234"
```

#### 6.1.3 Web3Signed Claim Format

The plugin validates Web3Signed claim data from `metadatas.auth_claim` + `metadatas.auth_sig`:

```json
{
  "aud": "https://tunnel.vana.org",
  "iat": 1707091200,
  "exp": 1707091500,
  "owner": "0xABC1234567890abcdef1234567890abcdef1234",
  "wallet": "0xABC1234567890abcdef1234567890abcdef1234",
  "subdomain": "0xabc1234567890abcdef1234567890abcdef1234",
  "runId": "abc123"
}
```

| Field       | Type   | Description                         |
| ----------- | ------ | ----------------------------------- |
| `aud`       | string | Audience — tunnel service URL       |
| `iat`       | number | Issued-at timestamp (Unix seconds)  |
| `exp`       | number | Expiration timestamp (Unix seconds) |
| `owner`     | string | Owner wallet that authorizes tunnel |
| `wallet`    | string | Wallet routed by subdomain          |
| `subdomain` | string | Claimed subdomain, lowercase wallet |
| `runId`     | string | Per-process session identifier      |

**Specifications:**

- Clock skew tolerance: **60 seconds**
- Claim TTL: **5 minutes** (300 seconds)
- Signature: EIP-191 over base64url-encoded payload string (`auth_claim`)

**Note:** Unlike Storage/API requests, `method`, `uri`, and `bodyHash` are not required because this is connection-level auth.

#### 6.1.4 Auth Plugin Operations

The Auth Plugin handles two frps operations:

**Login Operation Request:**

```json
{
  "content": {
    "version": "0.58.1",
    "privilege_key": "",
    "metas": {
      "wallet": "0xABC...",
      "owner": "0xABC...",
      "run_id": "abc123",
      "auth_claim": "{base64url(payload)}",
      "auth_sig": "0x{signature}"
    },
    "client_address": "1.2.3.4:12345"
  }
}
```

**Login Validation Steps:**

1. Parse `metas.auth_claim` + `metas.auth_sig` as Web3Signed claim/signature
2. Verify EIP-191 signature, recover signer address
3. Check `iat`/`exp` within bounds
4. Validate claim binding:
   - `claim.owner === metas.owner`
   - `claim.wallet === metas.wallet`
   - `claim.subdomain === metas.wallet.toLowerCase()`
   - `claim.runId === metas.run_id`
5. If signer === `metas.owner` → authorized (direct owner)
6. Else, query Gateway: `GET /v1/servers/{signer}`
   - Verify `data.ownerAddress === metas.owner`
   - Cache result (TTL: 60 seconds)
7. Store verified session claim in in-memory cache keyed by `run_id` for NewProxy checks

**Compatibility:** If `metas.auth_claim` is absent and `privilege_key` is non-empty, plugin may parse `privilege_key` as `Web3Signed {payload}.{sig}` for backward compatibility during rollout.

**NewProxy Operation Request:**

```json
{
  "content": {
    "user": {
      "metas": { "wallet": "0xABC...", "owner": "0xABC...", "run_id": "abc123" }
    },
    "subdomain": "0xabc..."
  }
}
```

**NewProxy Validation:**

1. Extract `subdomain` from request
2. Extract `wallet` from `user.metas`
3. Verify `subdomain === wallet.toLowerCase()`
4. Lookup cached Login claim by `user.metas.run_id`
5. Verify cached claim matches `wallet`, `owner`, and `subdomain`
6. Reject if any mismatch

#### 6.1.5 Authorization Model

Two actors can establish tunnels:

1. **Owner directly** (e.g., from Desktop App)
   - Signer address === metas.owner
   - No Gateway lookup needed

2. **Personal Server** (signs with server keypair)
   - Signer address !== metas.owner
   - Auth Plugin verifies delegation via Gateway

#### 6.1.6 Server Delegation Verification

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Auth Plugin    │     │  Gateway        │     │  (cache)        │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ signer ≠ owner        │                       │
         │                       │                       │
         │ 1. Check cache        │                       │
         │──────────────────────────────────────────────▶│
         │                       │                       │
         │ 2. Cache miss         │                       │
         │◀──────────────────────────────────────────────│
         │                       │                       │
         │ 3. GET /v1/servers/{signer}                   │
         │──────────────────────▶│                       │
         │                       │                       │
         │ 4. { ownerAddress }   │                       │
         │◀──────────────────────│                       │
         │                       │                       │
         │ 5. Store in cache     │                       │
         │──────────────────────────────────────────────▶│
         │                       │                       │
         │ 6. Verify ownerAddress === metas.owner        │
```

**Caching Strategy:**

- **Delegation cache key:** `delegation:{signerAddress}`
- **Delegation cache value:** `{ ownerAddress, cachedAt }`
- **Delegation cache TTL:** 60 seconds
- **Login session cache key:** `login:{runId}`
- **Login session cache value:** `{ owner, wallet, subdomain, signerAddress, verifiedAt }`
- **Login session cache TTL:** 10 minutes
- **Cache store:** In-memory

#### 6.1.7 FRP Behavior Notes (from frp repo/docs)

- Server plugin operation hooks include `Login`, `NewProxy`, `CloseProxy`, `Ping`, `NewWorkConn`, and `NewUserConn`; MVP uses `Login` + `NewProxy` only.
- FRP expects plugin HTTP responses to return status code 200 with plugin JSON payload; non-200 is treated as an exception path.
- FRP supports `auth.tokenSource` from file in addition to static `auth.token`; this is useful if we later reintroduce base-layer token auth with rotation.
- FRP supports `auth.additionalScopes` (`HeartBeats`, `NewWorkConns`) for base auth hardening; evaluate if we re-enable built-in token/oidc auth.
- `loginFailExit = false` in frpc is recommended for desktop clients so tunnel reconnect retries continue during transient outages.

### 6.2 Security Considerations

#### 6.2.1 Threat Model

| Threat                           | Mitigation                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Unauthorized tunnel registration | Web3Signed auth, Gateway attestation for server delegation                                   |
| Replay attacks                   | Short TTL (5 min), `runId` binding, claim cache on Login/NewProxy                            |
| Subdomain hijacking              | Signed claim binds `wallet` + `subdomain`; plugin enforces exact match on Login and NewProxy |
| DDoS on frps                     | Cloudflare DDoS protection, future rate limiting                                             |
| Man-in-the-middle                | TLS everywhere (Cloudflare edge + origin cert)                                               |
| Claim theft                      | Short expiration, `runId` scoping, server delegation verification                            |
| Tunnel enumeration               | Subdomains are wallet addresses (public anyway)                                              |

#### 6.2.2 Security Checklist

- [ ] TLS for all connections (Cloudflare edge + origin)
- [ ] Signed claim authentication for frpc connections
- [ ] Wallet signature verification for signed claim issuance
- [ ] Subdomain isolation (one wallet = one subdomain)
- [ ] Port 443 restricted to Cloudflare IP ranges
- [ ] No sensitive data in frps logs
- [ ] Firewall rules restrict access to necessary ports only
- [ ] SSH via IAP only (no direct SSH exposure)

---

## 7. Personal Server Tunnel Integration

### 7.1 frpc Binary Bundling

The Personal Server ships with the `frpc` binary for each supported platform:

| Platform    | Binary                   | Size (compressed) |
| ----------- | ------------------------ | ----------------- |
| Windows x64 | `frpc_windows_amd64.exe` | ~5 MB             |
| macOS x64   | `frpc_darwin_amd64`      | ~5 MB             |
| macOS ARM64 | `frpc_darwin_arm64`      | ~5 MB             |
| Linux x64   | `frpc_linux_amd64`       | ~5 MB             |

### 7.2 frpc Configuration Template

```toml
# Generated by Personal Server at runtime
# ~/.vana/frpc.toml

serverAddr = "frpc.server.vana.org"
serverPort = 7000

# Metadata for Auth Plugin validation (plugin-first auth, no shared static token)
metadatas.wallet = "{{ WALLET_ADDRESS }}"
metadatas.owner = "{{ OWNER_ADDRESS }}"
metadatas.run_id = "{{ RUN_ID }}"
metadatas.auth_claim = "{{ BASE64URL_PAYLOAD_JSON }}"
metadatas.auth_sig = "{{ EIP191_SIGNATURE }}"

loginFailExit = false

transport.tls.enable = true
# transport.tls.trustedCaFile = "/path/to/ca.crt"  # If using custom CA

log.to = "{{ LOG_PATH }}"
log.level = "info"

[[proxies]]
name = "personal-server"
type = "http"
localIP = "127.0.0.1"
localPort = 8080
subdomain = "{{ WALLET_ADDRESS_LOWERCASE }}"

# Custom headers (optional)
# [proxies.requestHeaders.set]
# X-Forwarded-Proto = "https"
```

### 7.3 Personal Server Integration Code

```typescript
// packages/server/src/tunnel/manager.ts

import { spawn, ChildProcess } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { Wallet } from "ethers";
import { encodeBase64Url } from "../utils/base64.js";

interface TunnelConfig {
  walletAddress: string; // Owner's wallet address
  ownerAddress: string; // Owner's wallet address (same as walletAddress for owner, different for server)
  serverKeypair: Wallet; // Server's signing keypair
  runId: string; // Unique per-process/session ID
  serverAddr: string;
  serverPort: number;
  localPort: number;
}

export class TunnelManager {
  private frpcProcess: ChildProcess | null = null;
  private configPath: string;
  private frpcBinaryPath: string;

  constructor(private dataDir: string) {
    this.configPath = join(dataDir, "frpc.toml");
    this.frpcBinaryPath = this.getFrpcBinaryPath();
  }

  private getFrpcBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === "win32" ? ".exe" : "";
    return join(__dirname, "bin", `frpc_${platform}_${arch}${ext}`);
  }

  /**
   * Generate signed claim data for plugin-first Login/NewProxy validation.
   */
  private async generateSignedClaim(
    config: TunnelConfig,
  ): Promise<{ claim: string; sig: string }> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      aud: "https://tunnel.vana.org",
      iat: now,
      exp: now + 300, // 5 minute TTL
      owner: config.ownerAddress,
      wallet: config.walletAddress,
      subdomain: config.walletAddress.toLowerCase(),
      runId: config.runId,
    };

    const claim = encodeBase64Url(JSON.stringify(payload));
    const sig = await config.serverKeypair.signMessage(claim);
    return { claim, sig };
  }

  async start(config: TunnelConfig): Promise<string> {
    const { claim, sig } = await this.generateSignedClaim(config);

    // Generate frpc config with signed metadata claim.
    const configContent = this.generateConfig(config, claim, sig);
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.configPath, configContent);

    // Start frpc process
    this.frpcProcess = spawn(this.frpcBinaryPath, ["-c", this.configPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.frpcProcess.stdout?.on("data", (data) => {
      console.log(`[frpc] ${data}`);
    });

    this.frpcProcess.stderr?.on("data", (data) => {
      console.error(`[frpc] ${data}`);
    });

    this.frpcProcess.on("exit", (code) => {
      console.log(`[frpc] Process exited with code ${code}`);
      this.frpcProcess = null;
    });

    const subdomain = config.walletAddress.toLowerCase();
    return `https://${subdomain}.server.vana.org`;
  }

  async stop(): Promise<void> {
    if (this.frpcProcess) {
      this.frpcProcess.kill("SIGTERM");
      this.frpcProcess = null;
    }
  }

  isRunning(): boolean {
    return this.frpcProcess !== null;
  }

  private generateConfig(
    config: TunnelConfig,
    claim: string,
    sig: string,
  ): string {
    return `
serverAddr = "${config.serverAddr}"
serverPort = ${config.serverPort}
loginFailExit = false

# Metadata for Auth Plugin validation
metadatas.wallet = "${config.walletAddress}"
metadatas.owner = "${config.ownerAddress}"
metadatas.run_id = "${config.runId}"
metadatas.auth_claim = "${claim}"
metadatas.auth_sig = "${sig}"

transport.tls.enable = true

log.to = "${join(this.dataDir, "frpc.log").replace(/\\/g, "/")}"
log.level = "info"

[[proxies]]
name = "personal-server"
type = "http"
localIP = "127.0.0.1"
localPort = ${config.localPort}
subdomain = "${config.walletAddress.toLowerCase()}"
`.trim();
  }
}
```

### 7.4 Tunnel Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PERSONAL SERVER TUNNEL LIFECYCLE                                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  SERVER STARTUP                                                         ││
│  │  1. User opens Desktop App                                              ││
│  │  2. App authenticates user (Privy)                                      ││
│  │  3. App starts Personal Server (localhost:8080)                         ││
│  │  4. Personal Server generates signed Web3 claim (using server keypair)   ││
│  │  5. Personal Server starts frpc with claim/sig in metadatas             ││
│  │  6. frps Auth Plugin validates claim + delegation via Gateway           ││
│  │  7. Tunnel established → URL registered in DataPortabilityServers       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  RUNNING STATE                                                          ││
│  │  • Personal Server handles requests via tunnel                          ││
│  │  • frpc maintains persistent connection to frps                         ││
│  │  • Personal Server monitors frpc health, restarts if needed             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  SERVER SHUTDOWN                                                        ││
│  │  1. User closes Desktop App (or system shutdown)                        ││
│  │  2. Personal Server stops frpc daemon (SIGTERM)                         ││
│  │  3. Tunnel terminates                                                   ││
│  │  4. Builders receive 503/timeout for requests to this user              ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. API Specification

### 8.1 Auth Plugin API

The Auth Plugin runs as a **sidecar alongside frps** on the same VM. frps calls this plugin via HTTP on Login and NewProxy operations.

See Section 9.2 for deployment details.

#### 8.1.1 POST /handler (Login Operation)

Called by frps when a client connects. Query param: `?op=Login`

**Request from frps:**

```json
{
  "content": {
    "version": "0.58.1",
    "hostname": "desktop-abc123",
    "os": "darwin",
    "arch": "arm64",
    "user": "",
    "timestamp": 1707091200,
    "privilege_key": "",
    "run_id": "abc123",
    "metas": {
      "wallet": "0xABC1234567890abcdef1234567890abcdef1234",
      "owner": "0xABC1234567890abcdef1234567890abcdef1234",
      "run_id": "abc123",
      "auth_claim": "eyJhdWQiOiJodHRwczovL3R1bm5lbC52YW5hLm9yZyIsImlhdCI6MTcwNzA5MTIwMCwiZXhwIjoxNzA3MDkxNTAwLCJvd25lciI6IjB4QUJDIiwi...",
      "auth_sig": "0x..."
    },
    "client_address": "1.2.3.4:12345"
  }
}
```

**Response (Approved):**

```json
{
  "reject": false,
  "unchange": true
}
```

**Response (Rejected):**

```json
{
  "reject": true,
  "reject_reason": "Invalid signature"
}
```

**HTTP status behavior:** Plugin responses should return HTTP `200` with `reject`/`reject_reason` fields. frps treats non-200 responses as plugin exceptions.

#### 8.1.2 POST /handler (NewProxy Operation)

Called by frps when a client registers a proxy. Query param: `?op=NewProxy`

**Request from frps:**

```json
{
  "content": {
    "user": {
      "user": "",
      "metas": {
        "wallet": "0xABC1234567890abcdef1234567890abcdef1234",
        "owner": "0xABC1234567890abcdef1234567890abcdef1234",
        "run_id": "abc123"
      },
      "run_id": "abc123"
    },
    "proxy_name": "personal-server",
    "proxy_type": "http",
    "subdomain": "0xabc1234567890abcdef1234567890abcdef1234",
    "custom_domains": [],
    "locations": []
  }
}
```

**Response (Approved):**

```json
{
  "reject": false,
  "unchange": true
}
```

**Response (Rejected - subdomain mismatch):**

```json
{
  "reject": true,
  "reject_reason": "Subdomain does not match wallet address"
}
```

#### 8.1.3 GET /health (Auth Plugin Health)

Health endpoint served by the existing Auth Plugin Hono server.

**Checks:**

- process is running and request loop is alive
- required config is loaded
- cache/store subsystem is initialized
- frps dashboard is reachable on `127.0.0.1:7500`
- local frps ports `443` and `7000` are listening

**Response (healthy):**

```json
{
  "ok": true,
  "service": "auth-plugin"
}
```

**Response (unhealthy):**

```json
{
  "ok": false,
  "service": "auth-plugin",
  "reason": "..."
}
```

### 8.2 Tunnel Status Endpoint

Optional endpoint for checking tunnel status.

#### 8.2.1 GET /v1/tunnel/status/{walletAddress}

**Response (200 OK - Tunnel Active):**

```json
{
  "walletAddress": "0xABC1234567890abcdef1234567890abcdef1234",
  "tunnelUrl": "https://0xabc1234567890abcdef1234567890abcdef1234.server.vana.org",
  "status": "connected",
  "connectedSince": "2026-02-04T10:30:00Z"
}
```

**Response (200 OK - Tunnel Inactive):**

```json
{
  "walletAddress": "0xABC1234567890abcdef1234567890abcdef1234",
  "tunnelUrl": "https://0xabc1234567890abcdef1234567890abcdef1234.server.vana.org",
  "status": "disconnected",
  "lastSeen": "2026-02-04T08:15:00Z"
}
```

---

## 9. Deployment & Operations

### 9.1 Initial Deployment Script

```bash
#!/bin/bash
# deploy-frps.sh - Initial FRP server deployment

set -euo pipefail

# Configuration
FRP_VERSION="0.58.1"
FRP_USER="frp"
FRP_DIR="/etc/frp"
FRP_LOG_DIR="/var/log/frp"
CERT_DIR="/etc/frp/certs"

echo "=== Vana FRP Server Deployment ==="

# 1. Create frp user
echo "[1/8] Creating frp user..."
useradd --system --no-create-home --shell /usr/sbin/nologin ${FRP_USER} || true

# 2. Download and install frp
echo "[2/8] Downloading frp v${FRP_VERSION}..."
cd /tmp
curl -LO "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz"
tar -xzf "frp_${FRP_VERSION}_linux_amd64.tar.gz"
cp "frp_${FRP_VERSION}_linux_amd64/frps" /usr/local/bin/
chmod +x /usr/local/bin/frps

# 3. Create directories
echo "[3/8] Creating directories..."
mkdir -p ${FRP_DIR} ${FRP_LOG_DIR} ${CERT_DIR}
chown ${FRP_USER}:${FRP_USER} ${FRP_LOG_DIR}

# 4. Copy configuration (assumes frps.toml is in current directory)
echo "[4/8] Installing configuration..."
cp frps.toml ${FRP_DIR}/frps.toml
chmod 600 ${FRP_DIR}/frps.toml

# 5. Copy TLS certificates (assumes already generated/downloaded)
echo "[5/8] Installing TLS certificates..."
# Cloudflare Origin Certificate should be copied here
# cp server.crt ${CERT_DIR}/
# cp server.key ${CERT_DIR}/
# chown ${FRP_USER}:${FRP_USER} ${CERT_DIR}/*
# chmod 600 ${CERT_DIR}/*

# 6. Install systemd service
echo "[6/8] Installing systemd service..."
cat > /etc/systemd/system/frps.service << 'EOF'
[Unit]
Description=FRP Server Service
After=network.target

[Service]
Type=simple
User=frp
Group=frp
EnvironmentFile=/etc/frp/frps.env
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/frp

[Install]
WantedBy=multi-user.target
EOF

# 7. Create environment file with secrets
echo "[7/8] Creating environment file..."
DASHBOARD_PASS=$(openssl rand -hex 16)

cat > ${FRP_DIR}/frps.env << EOF
DASHBOARD_PASSWORD=${DASHBOARD_PASS}
EOF
chmod 600 ${FRP_DIR}/frps.env

echo "=== IMPORTANT: Save these credentials ==="
echo "DASHBOARD_PASSWORD: ${DASHBOARD_PASS}"
echo "========================================="

# 8. Start service
echo "[8/8] Starting frps service..."
systemctl daemon-reload
systemctl enable frps
systemctl start frps
systemctl status frps

echo "=== Deployment Complete ==="
echo "frps is running on ports 7000 (frpc control) and 443 (builder HTTPS)"
echo "Control endpoint: frpc.server.vana.org:7000 (DNS-only record)"
echo "Builder endpoint base: https://{wallet}.server.vana.org (Cloudflare proxied)"
```

### 9.2 Auth Plugin Sidecar Deployment

The Auth Plugin runs alongside frps on the same VM as a containerized service. frps calls the plugin on Login and NewProxy operations.

#### 9.2.1 frps Plugin Configuration

Update `frps.toml` to enable the Auth Plugin:

```toml
# /etc/frp/frps.toml (add to existing config)

# Auth Plugin - validates Web3Signed claims
[[httpPlugins]]
name = "auth-plugin"
addr = "127.0.0.1:9000"
path = "/handler"
ops = ["Login", "NewProxy"]
```

#### 9.2.2 Auth Plugin Configuration

```yaml
# /etc/auth-plugin/config.yaml
server:
  port: 9000
  host: "127.0.0.1" # Localhost only, frps calls internally

auth:
  # Web3Signed validation
  audience: "https://tunnel.vana.org"
  clockSkew: 60s
  loginSessionCacheTTL: 600s

gateway:
  # For server delegation verification
  url: "https://gateway.vana.org"
  cacheTTL: 60s

logging:
  level: info
  format: json
```

#### 9.2.3 Docker Compose (VM deployment)

```yaml
# /etc/auth-plugin/docker-compose.yml
version: "3.8"

services:
  auth-plugin:
    image: ghcr.io/vana-com/frp-auth-plugin:latest
    container_name: auth-plugin
    restart: always
    ports:
      - "127.0.0.1:9000:9000"
    volumes:
      - ./config.yaml:/app/config.yaml:ro
    environment:
      - GATEWAY_URL=https://gateway.vana.org
    networks:
      - frp-network

networks:
  frp-network:
    driver: bridge
```

#### 9.2.4 Systemd Service (for Docker Compose)

```ini
# /etc/systemd/system/auth-plugin.service
[Unit]
Description=FRP Auth Plugin (Docker)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/etc/auth-plugin
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

#### 9.2.5 Environment Variables

```bash
# /etc/auth-plugin/.env
GATEWAY_URL=https://gateway.vana.org
LOG_LEVEL=info
```

**Note:** The Auth Plugin does not need external firewall rules since it only listens on localhost (127.0.0.1:9000). frps communicates with it internally.

### 9.3 Cloudflare Origin Certificate Setup

```bash
#!/bin/bash
# setup-origin-cert.sh - Generate Cloudflare Origin Certificate

# 1. Go to Cloudflare Dashboard > SSL/TLS > Origin Server
# 2. Create Certificate:
#    - Private key type: RSA (2048)
#    - Hostnames: *.server.vana.org, server.vana.org
#    - Certificate Validity: 15 years
# 3. Download certificate and key

# 4. Install on server
CERT_DIR="/etc/frp/certs"

# Copy the downloaded files
cp origin-cert.pem ${CERT_DIR}/server.crt
cp origin-key.pem ${CERT_DIR}/server.key

# Set permissions
chown frp:frp ${CERT_DIR}/*
chmod 600 ${CERT_DIR}/*

# Update frps.toml to use these certs
# transport.tls.certFile = "/etc/frp/certs/server.crt"
# transport.tls.keyFile = "/etc/frp/certs/server.key"

# Restart frps
systemctl restart frps
```

### 9.4 Upgrade Procedure

```bash
#!/bin/bash
# upgrade-frps.sh - Upgrade FRP server

set -euo pipefail

NEW_VERSION="${1:-0.58.1}"

echo "Upgrading frps to v${NEW_VERSION}..."

# 1. Download new version
cd /tmp
curl -LO "https://github.com/fatedier/frp/releases/download/v${NEW_VERSION}/frp_${NEW_VERSION}_linux_amd64.tar.gz"
tar -xzf "frp_${NEW_VERSION}_linux_amd64.tar.gz"

# 2. Stop service
systemctl stop frps

# 3. Backup old binary
cp /usr/local/bin/frps /usr/local/bin/frps.bak

# 4. Install new binary
cp "frp_${NEW_VERSION}_linux_amd64/frps" /usr/local/bin/
chmod +x /usr/local/bin/frps

# 5. Start service
systemctl start frps

# 6. Verify
sleep 2
systemctl status frps
/usr/local/bin/frps --version

echo "Upgrade complete. Old binary backed up to /usr/local/bin/frps.bak"
```

### 9.5 Rollback Procedure

```bash
#!/bin/bash
# rollback-frps.sh - Rollback FRP server

systemctl stop frps
cp /usr/local/bin/frps.bak /usr/local/bin/frps
systemctl start frps
systemctl status frps
```

### 9.6 External Health Endpoint Deployment

Deploy a dedicated local frpc client that exposes the existing Auth Plugin `/health` endpoint through frps, so external probes traverse the real FRP data path.

```toml
# /etc/frp/frpc-system-health.toml
serverAddr = "127.0.0.1"
serverPort = 7000
loginFailExit = false

# Signed metadata claims (same plugin validation model as normal clients)
metadatas.wallet = "0xHEALTH..."
metadatas.owner = "0xHEALTH..."
metadatas.run_id = "system-health-monitor"
metadatas.auth_claim = "{base64url(payloadJson)}"
metadatas.auth_sig = "0x{signature}"

[[proxies]]
name = "system-health-endpoint"
type = "http"
localIP = "127.0.0.1"
localPort = 9000
custom_domains = ["server.vana.org"]
```

```bash
# Example verification from outside:
curl -fsS https://server.vana.org/health
```

---

## 10. Monitoring & Observability

### 10.1 Health Checks

#### 10.1.1 frps Dashboard

frps provides a built-in web dashboard at `http://localhost:7500` (internal only).

```bash
# Check dashboard locally via SSH tunnel
ssh -L 7500:localhost:7500 frp-server
# Then open http://localhost:7500 in browser
```

#### 10.1.2 External Health Check

Expose a dedicated external endpoint:

- `https://server.vana.org/health`
- Polled by external uptime monitor from outside the VPC

This endpoint should represent **real service health**, not just process liveness. Implement it by exposing the existing Auth Plugin `/health` via a dedicated local frpc registration so the probe exercises the real data path:

1. Monitor calls `https://server.vana.org/health`
2. Cloudflare resolves/terminates TLS
3. frps routes `server.vana.org` to the system health frpc tunnel
4. Auth Plugin `/health` returns `200` only if:
   - auth-plugin process/request loop is healthy
   - frps dashboard is reachable on `127.0.0.1:7500`
   - local frps ports `443` and `7000` are listening

Return `503` with structured failure reasons when any dependency is unhealthy.

```bash
# External probe example
curl -fsS https://server.vana.org/health
```

### 10.2 Metrics (MVP)

For MVP, collect basic metrics via logs and simple scripts:

| Metric                   | Collection Method                          | Alert Threshold                        |
| ------------------------ | ------------------------------------------ | -------------------------------------- |
| frps process up          | `systemctl is-active`                      | Process not active                     |
| auth-plugin process up   | `systemctl is-active auth-plugin`          | Process not active                     |
| External health endpoint | `curl -fsS https://server.vana.org/health` | Non-200 or timeout                     |
| Active tunnels           | Parse dashboard or logs                    | N/A (informational)                    |
| CPU usage                | `top` / `ps`                               | > 80% sustained                        |
| Memory usage             | `free` / `ps`                              | > 80% of available                     |
| Disk usage               | `df`                                       | > 90%                                  |
| Connection errors        | Parse frps.log                             | > 10/min                               |
| Auth rejects             | Parse auth-plugin logs                     | > 20/min (investigate abuse/misconfig) |

### 10.3 Logging

#### 10.3.1 Log Locations

| Log                     | Path                                                    | Rotation               |
| ----------------------- | ------------------------------------------------------- | ---------------------- |
| frps application        | `/var/log/frp/frps.log`                                 | 7 days (frps config)   |
| auth-plugin (container) | `journalctl -u auth-plugin` / `docker logs auth-plugin` | systemd/docker default |
| systemd journal         | `journalctl -u frps`                                    | systemd default        |

#### 10.3.2 Log Parsing

```bash
# Count active connections
grep "new proxy" /var/log/frp/frps.log | wc -l

# Check externally observed health from another network
curl -fsS https://server.vana.org/health

# Find connection errors
grep -i "error" /var/log/frp/frps.log | tail -20

# Inspect auth-plugin rejects/errors
journalctl -u auth-plugin -n 100

# Watch real-time logs
journalctl -u frps -f
```

### 10.4 Outage Polling (MVP)

Use an external monitor (e.g., uptime checker) to poll:

- `GET https://server.vana.org/health`
- Interval: 30-60 seconds
- Healthy: HTTP `200`
- Unhealthy: HTTP `503` or timeout

This is the primary outage signal for MVP; no cron-based local notifier is required.

---

## 11. Implementation Plan

### 11.1 Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  IMPLEMENTATION PHASES                                                       │
│                                                                              │
│  Phase 1: Infrastructure Setup (3-4 days)                                    │
│  ├── GCP project & VM setup                                                  │
│  ├── Cloudflare DNS & SSL configuration                                      │
│  ├── frps installation & configuration                                       │
│  └── Basic health monitoring                                                 │
│                                                                              │
│  Phase 2: Auth Plugin Service (2-3 days)                                     │
│  ├── Copy Web3Signed auth from personal-server-ts                            │
│  ├── Implement Login handler (validate Web3Signed)                           │
│  ├── Implement NewProxy handler (validate subdomain)                         │
│  └── Gateway client for delegation verification                              │
│                                                                              │
│  Phase 3: Personal Server Integration (2-3 days)                             │
│  ├── frpc binary bundling                                                    │
│  ├── TunnelManager implementation                                            │
│  ├── Web3Signed claim generation                                             │
│  └── Tunnel lifecycle management                                             │
│                                                                              │
│  Phase 4: Testing & Hardening (2-3 days)                                     │
│  ├── End-to-end testing                                                      │
│  ├── Load testing                                                            │
│  ├── Security review                                                         │
│  └── Documentation                                                           │
│                                                                              │
│  Total: 9-13 days                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Detailed Task Breakdown

#### Phase 1: Infrastructure Setup (3-4 days)

| Task | Description                                                                               | Owner | Status |
| ---- | ----------------------------------------------------------------------------------------- | ----- | ------ |
| 1.1  | Create GCP project and enable APIs                                                        | Infra | [ ]    |
| 1.2  | Reserve static external IP                                                                | Infra | [ ]    |
| 1.3  | Create Compute Engine VM                                                                  | Infra | [ ]    |
| 1.4  | Configure firewall rules                                                                  | Infra | [ ]    |
| 1.5  | Add Cloudflare DNS records                                                                | Infra | [ ]    |
| 1.6  | Configure Cloudflare SSL/TLS                                                              | Infra | [ ]    |
| 1.7  | Generate Origin Certificate                                                               | Infra | [ ]    |
| 1.8  | Deploy frps with initial config                                                           | Infra | [ ]    |
| 1.9  | Verify tunnel routing works                                                               | Infra | [ ]    |
| 1.10 | Deploy external health endpoint (`server.vana.org/health`) and configure external polling | Infra | [ ]    |

#### Phase 2: Auth Plugin Service (2-3 days)

| Task | Description                                                     | Owner   | Status |
| ---- | --------------------------------------------------------------- | ------- | ------ |
| 2.1  | Copy Web3Signed auth from `personal-server-ts`                  | Backend | [ ]    |
| 2.2  | Implement Hono server with `/handler` and `/health` endpoints   | Backend | [ ]    |
| 2.3  | Implement Login handler (validate Web3Signed, check delegation) | Backend | [ ]    |
| 2.4  | Implement NewProxy handler (validate subdomain === wallet)      | Backend | [ ]    |
| 2.5  | Add Gateway client for delegation verification                  | Backend | [ ]    |
| 2.6  | Write unit tests and Dockerfile                                 | Backend | [ ]    |
| 2.7  | Deploy Auth Plugin as sidecar container                         | Backend | [ ]    |

#### Phase 3: Personal Server Integration (2-3 days)

| Task | Description                                                  | Owner  | Status |
| ---- | ------------------------------------------------------------ | ------ | ------ |
| 3.1  | Bundle frpc binaries for all platforms                       | Server | [ ]    |
| 3.2  | Implement TunnelManager class                                | Server | [ ]    |
| 3.3  | Implement Web3Signed claim generation (using server keypair) | Server | [ ]    |
| 3.4  | Add tunnel status to server API                              | Server | [ ]    |
| 3.5  | Handle tunnel reconnection                                   | Server | [ ]    |
| 3.6  | Update DataPortabilityServers on connect                     | Server | [ ]    |

#### Phase 4: Testing & Hardening (2-3 days)

| Task | Description                               | Owner    | Status |
| ---- | ----------------------------------------- | -------- | ------ |
| 4.1  | End-to-end test: Desktop → frps → Builder | QA       | [ ]    |
| 4.2  | Load test: 100+ concurrent tunnels        | QA       | [ ]    |
| 4.3  | Security review: claim handling, TLS      | Security | [ ]    |
| 4.4  | Failure scenario testing                  | QA       | [ ]    |
| 4.5  | Write operational runbook                 | Infra    | [ ]    |
| 4.6  | Update protocol documentation             | Docs     | [ ]    |

### 11.3 Dependencies

```
Phase 1 (Infrastructure)
    │
    ├──▶ Phase 2 (Auth Plugin) ────┐
    │                              │
    └──▶ Phase 3 (Server) ─────────┼──▶ Phase 4 (Testing)
                                   │
         (can start in parallel    │
          after Phase 1 complete)  │
```

---

## 12. Cost Estimation

### 12.1 GCP Costs (Monthly)

| Resource        | Spec                     | Cost/Month     |
| --------------- | ------------------------ | -------------- |
| Compute Engine  | e2-medium (2 vCPU, 4 GB) | ~$25           |
| Static IP       | 1 address                | ~$3            |
| Egress          | 100 GB (estimated)       | ~$8            |
| Persistent Disk | 20 GB SSD                | ~$3            |
| **Total GCP**   |                          | **~$40/month** |

### 12.2 Cloudflare Costs

| Resource             | Tier             | Cost/Month   |
| -------------------- | ---------------- | ------------ |
| DNS                  | Free             | $0           |
| SSL/TLS              | Free (Universal) | $0           |
| DDoS Protection      | Free (basic)     | $0           |
| **Total Cloudflare** |                  | **$0/month** |

### 12.3 Total MVP Cost

| Category           | Cost/Month     |
| ------------------ | -------------- |
| GCP Infrastructure | ~$40           |
| Cloudflare         | $0             |
| **Total**          | **~$40/month** |

### 12.4 Scaling Costs

As usage grows, costs scale primarily with:

- **Egress bandwidth**: ~$0.08/GB after first 100 GB
- **Compute**: May need larger VM (e2-standard-2: ~$50/month)
- **Multi-region**: 2-3x infrastructure cost for HA

---

## 13. Future Considerations

### 13.1 Multi-Region Deployment

For production HA, deploy frps in multiple regions with GeoDNS:

```
                    ┌─────────────────────────┐
                    │   Cloudflare GeoDNS     │
                    │   *.server.vana.org     │
                    └───────────┬─────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │  frps-us      │   │  frps-eu      │   │  frps-asia    │
    │  us-central1  │   │  europe-west1 │   │  asia-east1   │
    └───────────────┘   └───────────────┘   └───────────────┘
```

### 13.2 On-Chain Authentication

Replace token-based auth with on-chain verification:

1. frpc presents wallet address + signature
2. frps queries Gateway to verify wallet is registered in DataPortabilityServers
3. Subdomain must match registered server address

### 13.3 Rate Limiting

Implement per-user rate limits:

| Limit                       | Value |
| --------------------------- | ----- |
| Requests/minute/user        | 1000  |
| Bandwidth/hour/user         | 1 GB  |
| Concurrent connections/user | 100   |

### 13.4 Connection Analytics

Track and expose:

- Requests per user per day
- Bandwidth consumption
- Connection duration
- Error rates

### 13.5 Kubernetes Migration

For better orchestration and scaling:

```yaml
# kubernetes/frps-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frps
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frps
  template:
    spec:
      containers:
        - name: frps
          image: ghcr.io/vana-com/frps:latest
          ports:
            - containerPort: 7000
            - containerPort: 443
```

---

## Appendix

### A. FRP Version Compatibility

| frps Version | frpc Version | Notes               |
| ------------ | ------------ | ------------------- |
| 0.58.x       | 0.58.x       | Current recommended |
| 0.57.x       | 0.57.x       | Compatible          |
| 0.56.x       | 0.56.x       | Compatible          |

**Note:** frps and frpc should use matching major.minor versions.

### B. Troubleshooting

#### B.1 Tunnel Not Connecting

```bash
# Check frps is running
systemctl status frps

# Check frps logs
journalctl -u frps -n 100

# Check firewall
gcloud compute firewall-rules list

# Test control-plane connectivity
nc -zv frpc.server.vana.org 7000
```

#### B.2 SSL/TLS Errors

```bash
# Verify Cloudflare SSL mode is "Full (strict)"
# Verify origin certificate is valid
openssl x509 -in /etc/frp/certs/server.crt -text -noout

# Check certificate chain
curl -vI https://test.server.vana.org 2>&1 | grep -A 5 "SSL certificate"
```

#### B.3 Control Plane Not Connecting

```bash
# frpc endpoint must be DNS-only in Cloudflare (not proxied)
# Verify DNS response points to VM IP
dig +short frpc.server.vana.org

# Check port 7000 reachability
nc -zv frpc.server.vana.org 7000
```

#### B.4 High Latency

```bash
# Check CPU/memory
htop

# Check network
iftop

# Check connection count
ss -s
```

### C. Security Hardening Checklist

- [ ] SSH key-only authentication
- [ ] Fail2ban installed
- [ ] Automatic security updates enabled
- [ ] Firewall rules reviewed
- [ ] TLS 1.3 only (if possible)
- [ ] frps running as non-root user
- [ ] Secrets stored in Secret Manager (future)
- [ ] Audit logging enabled

### D. References

- [frp GitHub Repository](https://github.com/fatedier/frp)
- [frp Documentation](https://gofrp.org/docs/)
- [frp Authentication](https://gofrp.org/en/docs/features/common/authentication/)
- [frp Server Plugin](https://gofrp.org/en/docs/features/common/server-plugin/)
- [Cloudflare Origin Certificates](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [Cloudflare Network Ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/)
- [GCP Compute Engine](https://cloud.google.com/compute/docs)
- [Data Portability Protocol Spec](./260121-data-portability-protocol-spec.md)
- [Personal Server Scaffold](./260127-personal-server-scaffold.md)

---

## Revision History

| Version | Date       | Author | Changes       |
| ------- | ---------- | ------ | ------------- |
| 0.1.0   | 2026-02-04 | Claude | Initial draft |
