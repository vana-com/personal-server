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
7. [Desktop Client Integration](#7-desktop-client-integration)
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

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Proxy Technology | [frp](https://github.com/fatedier/frp) | Open-source, battle-tested, supports HTTP/HTTPS proxying with subdomain routing |
| Cloud Provider | Google Cloud Platform (GCP) | Reliable, global infrastructure, easy integration with Cloudflare |
| CDN/DNS | Cloudflare | Wildcard DNS, DDoS protection, edge TLS termination, free tier available |
| Compute | GCP Compute Engine (VM) | Simple, cost-effective for MVP; can migrate to GKE later |
| Authentication | Token-based | Simple for MVP, can evolve to on-chain verification |
| Subdomain Format | `{walletAddress}.server.vana.org` | Deterministic, collision-free, aligns with protocol spec |

### 1.3 Scope

**In Scope:**
- FRP server deployment and configuration
- Cloudflare DNS and TLS setup
- Token-based client authentication
- Health checking and basic monitoring
- Desktop App frpc integration specification

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
│  │  │  ├── Personal Server (localhost:8080)                               │││
│  │  │  └── frpc daemon                                                    │││
│  │  │       └── Outbound tunnel to Vana FRP server                        │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Outbound-only connection                  │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Vana FRP Server (proxy.server.vana.org)                               ││
│  │  URL: https://{walletAddress}.server.vana.org                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Builder request                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Builder App                                                            ││
│  │  GET https://{walletAddress}.server.vana.org/v1/data/instagram.profile ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Requirements

#### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Route HTTP requests to `{walletAddress}.server.vana.org` to the corresponding Personal Server | P0 |
| FR-2 | Support concurrent connections from multiple Desktop Apps | P0 |
| FR-3 | Authenticate frpc clients using tokens | P0 |
| FR-4 | Provide TLS termination for all inbound HTTPS traffic | P0 |
| FR-5 | Return appropriate errors when Personal Server is offline | P0 |
| FR-6 | Support WebSocket connections for future MCP SSE transport | P1 |

#### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Availability | 99% (MVP) |
| NFR-2 | Latency overhead | < 50ms p99 |
| NFR-3 | Concurrent tunnels | 10,000+ |
| NFR-4 | Time to establish tunnel | < 2 seconds |

### 2.4 Why FRP over Alternatives

| Aspect | FRP | Cloudflare Tunnel | ngrok |
|--------|-----|-------------------|-------|
| Third-party account | Not required | Required per-user | Required per-user |
| Subdomain control | Full control | Random or requires CF account | Paid feature |
| Self-hosted | Yes | No | Enterprise only |
| Open source | Yes (Apache 2.0) | No | No |
| Cost | Infrastructure only | Free tier, then paid | Paid |
| Custom domain | Yes | Complex | Paid |

FRP provides full control over the tunneling infrastructure without requiring users to create third-party accounts.

---

## 3. Architecture Overview

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    INTERNET                                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE EDGE                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐│
│  │  DNS: *.server.vana.org → proxy.server.vana.org (CNAME)                             ││
│  │  TLS: Wildcard certificate (*.server.vana.org)                                      ││
│  │  DDoS: Layer 3/4/7 protection                                                       ││
│  │  Mode: Full (strict) SSL/TLS                                                        ││
│  └─────────────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ HTTPS (443)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              GCP COMPUTE ENGINE                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────┐│
│  │  frps (FRP Server)                                                                  ││
│  │  ├── HTTP Proxy: 443 (TLS terminated by Cloudflare, or origin cert)                 ││
│  │  ├── Control Port: 7000 (frpc connections)                                          ││
│  │  ├── Dashboard: 7500 (internal metrics)                                             ││
│  │  └── Subdomain routing: {walletAddress} → tunnel connection                         ││
│  └─────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                          │
│  External IP: 34.xxx.xxx.xxx (proxy.server.vana.org)                                    │
│  Firewall: Allow 443 (HTTPS), 7000 (frpc), deny others                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                         ▲
                                         │ TCP (7000) - frp control channel
                                         │
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              USER DEVICES                                                │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐│
│  │  Desktop App (User A)    │  │  Desktop App (User B)    │  │  Desktop App (User N)    ││
│  │  ├── Personal Server     │  │  ├── Personal Server     │  │  ├── Personal Server     ││
│  │  │   (localhost:8080)    │  │  │   (localhost:8080)    │  │  │   (localhost:8080)    ││
│  │  └── frpc daemon         │  │  └── frpc daemon         │  │  └── frpc daemon         ││
│  │      subdomain: 0xABC... │  │      subdomain: 0xDEF... │  │      subdomain: 0x123... ││
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Request Flow

```
┌─────────┐     ┌───────────┐     ┌───────────┐     ┌───────────┐     ┌─────────────────┐
│ Builder │     │Cloudflare │     │ frps      │     │ frpc      │     │ Personal Server │
│   App   │     │   Edge    │     │ (GCP)     │     │ (Desktop) │     │  (localhost)    │
└────┬────┘     └─────┬─────┘     └─────┬─────┘     └─────┬─────┘     └────────┬────────┘
     │                │                 │                 │                    │
     │ 1. GET https://0xABC.server.vana.org/v1/data/instagram.profile         │
     │───────────────▶│                 │                 │                    │
     │                │                 │                 │                    │
     │                │ 2. DNS resolve  │                 │                    │
     │                │    + TLS term   │                 │                    │
     │                │────────────────▶│                 │                    │
     │                │                 │                 │                    │
     │                │                 │ 3. Route by     │                    │
     │                │                 │    subdomain    │                    │
     │                │                 │    "0xABC"      │                    │
     │                │                 │────────────────▶│                    │
     │                │                 │                 │                    │
     │                │                 │                 │ 4. Forward to      │
     │                │                 │                 │    localhost:8080  │
     │                │                 │                 │───────────────────▶│
     │                │                 │                 │                    │
     │                │                 │                 │ 5. Process request │
     │                │                 │                 │    (verify grant,  │
     │                │                 │                 │     return data)   │
     │                │                 │                 │◀───────────────────│
     │                │                 │                 │                    │
     │                │                 │◀────────────────│                    │
     │                │                 │                 │                    │
     │                │◀────────────────│                 │                    │
     │                │                 │                 │                    │
     │◀───────────────│                 │                 │                    │
     │                │                 │                 │                    │
     │ 6. Response    │                 │                 │                    │
     │    { data }    │                 │                 │                    │
     │                │                 │                 │                    │
```

### 3.3 Tunnel Establishment Flow

```
┌─────────────┐     ┌───────────────────┐     ┌─────────────┐
│ Desktop App │     │ Token Service     │     │ frps        │
│ + frpc      │     │ (API endpoint)    │     │ (GCP)       │
└──────┬──────┘     └─────────┬─────────┘     └──────┬──────┘
       │                      │                      │
       │ 1. User opens Desktop App                   │
       │                      │                      │
       │ 2. Request tunnel token                     │
       │     POST /v1/tunnel/token                   │
       │     { walletAddress, signature }            │
       │─────────────────────▶│                      │
       │                      │                      │
       │ 3. Verify signature, │                      │
       │    generate token    │                      │
       │◀─────────────────────│                      │
       │    { token, subdomain }                     │
       │                      │                      │
       │ 4. Start frpc with token + subdomain        │
       │─────────────────────────────────────────────▶
       │                      │                      │
       │                      │    5. Validate token │
       │                      │       Register tunnel│
       │                      │                      │
       │◀─────────────────────────────────────────────
       │    Tunnel established                       │
       │                      │                      │
       │ 6. Tunnel ready at   │                      │
       │    https://{wallet}.server.vana.org         │
       │                      │                      │
```

---

## 4. Infrastructure Design

### 4.1 Cloudflare Configuration

#### 4.1.1 DNS Records

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | `proxy.server` | `34.xxx.xxx.xxx` | Yes (orange cloud) | Auto |
| CNAME | `*.server` | `proxy.server.vana.org` | Yes (orange cloud) | Auto |

#### 4.1.2 SSL/TLS Settings

```yaml
# Cloudflare SSL/TLS Configuration
ssl_mode: full_strict  # Validates origin certificate

# Edge Certificates
edge_certificate:
  type: universal  # Free, auto-renewed
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
  mode: simulate  # Start in simulate mode

# Rate Limiting (future phase)
rate_limiting:
  enabled: false  # MVP: disabled
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
    source_ranges: ["0.0.0.0/0"]
    target_tags: ["frp-server"]
    allowed:
      - protocol: tcp
        ports: [443]

  - name: allow-frpc
    direction: INGRESS
    source_ranges: ["0.0.0.0/0"]
    target_tags: ["frp-server"]
    allowed:
      - protocol: tcp
        ports: [7000]

  - name: allow-ssh-iap
    direction: INGRESS
    source_ranges: ["35.235.240.0/20"]  # IAP range
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
│                              CLOUDFLARE                                      │
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
│                              GCP us-central1                                 │
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
vhostHTTPPort = 8080               # Internal HTTP (Cloudflare terminates TLS)
vhostHTTPSPort = 443               # Direct HTTPS if not using Cloudflare
subdomainHost = "server.vana.org"  # Base domain for subdomain routing

# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------
auth.method = "token"
auth.token = "{{ FRP_AUTH_TOKEN }}"  # Injected from environment/secrets

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
# TLS (origin certificate for Cloudflare Full Strict)
# -----------------------------------------------------------------------------
transport.tls.certFile = "/etc/frp/server.crt"
transport.tls.keyFile = "/etc/frp/server.key"
```

### 5.2 Environment Variables

```bash
# /etc/frp/frps.env
FRP_AUTH_TOKEN=<generated-secure-token>
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

### 6.1 Token-Based Authentication (MVP)

For MVP, we use a simple token-based authentication flow. The FRP server validates that clients present a valid token before allowing tunnel registration.

#### 6.1.1 Token Generation Flow

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Desktop App    │     │  Token Service      │     │  frps           │
│                 │     │  (Gateway or new)   │     │                 │
└────────┬────────┘     └──────────┬──────────┘     └────────┬────────┘
         │                         │                         │
         │ 1. POST /v1/tunnel/token                          │
         │    {                                              │
         │      walletAddress: "0xABC...",                   │
         │      timestamp: 1707091200,                       │
         │      signature: "0x..."                           │
         │    }                                              │
         │────────────────────────▶│                         │
         │                         │                         │
         │                         │ 2. Verify EIP-191       │
         │                         │    signature            │
         │                         │                         │
         │                         │ 3. Generate token       │
         │                         │    (JWT or opaque)      │
         │                         │                         │
         │ 4. Response             │                         │
         │    {                    │                         │
         │      token: "frp_...",  │                         │
         │      subdomain: "0xabc...",                       │
         │      expiresAt: "..."   │                         │
         │    }                    │                         │
         │◀────────────────────────│                         │
         │                         │                         │
         │ 5. Connect frpc with token                        │
         │─────────────────────────────────────────────────▶│
         │                         │                         │
         │                         │        6. Validate token│
         │                         │           (shared secret│
         │                         │            or JWT verify)
         │                         │                         │
         │◀─────────────────────────────────────────────────│
         │    Tunnel established                             │
```

#### 6.1.2 Token Format Options

**Option A: Shared Secret Token (Simpler MVP)**

```
Token format: frp_{base64(walletAddress)}_{timestamp}_{hmac}

Example: frp_MHhhYmMxMjM0NTY3ODkw_1707091200_a1b2c3d4e5f6

Validation:
1. Decode base64 to get walletAddress
2. Verify timestamp is within acceptable window (e.g., 24 hours)
3. Recompute HMAC with server secret and compare
```

**Option B: JWT Token (More Flexible)**

```json
{
  "sub": "0xabc1234567890...",
  "subdomain": "0xabc1234567890",
  "iat": 1707091200,
  "exp": 1707177600,
  "iss": "vana-tunnel-service"
}
```

For MVP, **Option A (Shared Secret)** is recommended for simplicity.

### 6.2 Security Considerations

#### 6.2.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized tunnel registration | Token authentication, wallet signature verification |
| Subdomain hijacking | Token includes wallet address, validated on connection |
| DDoS on frps | Cloudflare DDoS protection, future rate limiting |
| Man-in-the-middle | TLS everywhere (Cloudflare edge + origin cert) |
| Token theft | Short TTL (24h), can revoke by regenerating server secret |
| Tunnel enumeration | Subdomains are wallet addresses (public anyway) |

#### 6.2.2 Security Checklist

- [ ] TLS for all connections (Cloudflare edge + origin)
- [ ] Token authentication for frpc connections
- [ ] Wallet signature verification for token issuance
- [ ] Subdomain isolation (one wallet = one subdomain)
- [ ] No sensitive data in frps logs
- [ ] Firewall rules restrict access to necessary ports only
- [ ] SSH via IAP only (no direct SSH exposure)

---

## 7. Desktop Client Integration

### 7.1 frpc Binary Bundling

The Desktop App (Tauri) bundles the `frpc` binary for each supported platform:

| Platform | Binary | Size (compressed) |
|----------|--------|-------------------|
| Windows x64 | `frpc_windows_amd64.exe` | ~5 MB |
| macOS x64 | `frpc_darwin_amd64` | ~5 MB |
| macOS ARM64 | `frpc_darwin_arm64` | ~5 MB |
| Linux x64 | `frpc_linux_amd64` | ~5 MB |

### 7.2 frpc Configuration Template

```toml
# Generated by Desktop App at runtime
# ~/.vana/frpc.toml

serverAddr = "proxy.server.vana.org"
serverPort = 7000
auth.method = "token"
auth.token = "{{ TUNNEL_TOKEN }}"

transport.tls.enable = true
# transport.tls.trustedCaFile = "/path/to/ca.crt"  # If using custom CA

log.to = "{{ LOG_PATH }}"
log.level = "info"

[[proxies]]
name = "personal-server"
type = "http"
localIP = "127.0.0.1"
localPort = 8080
subdomain = "{{ WALLET_ADDRESS }}"

# Custom headers (optional)
# [proxies.requestHeaders.set]
# X-Forwarded-Proto = "https"
```

### 7.3 Desktop App Integration Code

```typescript
// packages/desktop/src/tunnel/manager.ts

import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

interface TunnelConfig {
  walletAddress: string;
  token: string;
  serverAddr: string;
  serverPort: number;
  localPort: number;
}

export class TunnelManager {
  private frpcProcess: ChildProcess | null = null;
  private configPath: string;
  private frpcBinaryPath: string;

  constructor(private dataDir: string) {
    this.configPath = join(dataDir, 'frpc.toml');
    this.frpcBinaryPath = this.getFrpcBinaryPath();
  }

  private getFrpcBinaryPath(): string {
    // Platform-specific binary path
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    return join(__dirname, 'bin', `frpc_${platform}_${arch}${ext}`);
  }

  async start(config: TunnelConfig): Promise<string> {
    // Generate frpc config
    const configContent = this.generateConfig(config);
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.configPath, configContent);

    // Start frpc process
    this.frpcProcess = spawn(this.frpcBinaryPath, ['-c', this.configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.frpcProcess.stdout?.on('data', (data) => {
      console.log(`[frpc] ${data}`);
    });

    this.frpcProcess.stderr?.on('data', (data) => {
      console.error(`[frpc] ${data}`);
    });

    this.frpcProcess.on('exit', (code) => {
      console.log(`[frpc] Process exited with code ${code}`);
      this.frpcProcess = null;
    });

    // Return tunnel URL
    const subdomain = config.walletAddress.toLowerCase();
    return `https://${subdomain}.server.vana.org`;
  }

  async stop(): Promise<void> {
    if (this.frpcProcess) {
      this.frpcProcess.kill('SIGTERM');
      this.frpcProcess = null;
    }
  }

  isRunning(): boolean {
    return this.frpcProcess !== null;
  }

  private generateConfig(config: TunnelConfig): string {
    return `
serverAddr = "${config.serverAddr}"
serverPort = ${config.serverPort}
auth.method = "token"
auth.token = "${config.token}"

transport.tls.enable = true

log.to = "${join(this.dataDir, 'frpc.log').replace(/\\/g, '/')}"
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
│  DESKTOP APP LIFECYCLE                                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  APP STARTUP                                                            ││
│  │  1. User opens Desktop App                                              ││
│  │  2. App authenticates user (Privy)                                      ││
│  │  3. App starts Personal Server (localhost:8080)                         ││
│  │  4. App requests tunnel token from Token Service                        ││
│  │  5. App starts frpc daemon with token                                   ││
│  │  6. Tunnel established → URL registered in DataPortabilityServers       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  RUNNING STATE                                                          ││
│  │  • Personal Server handles requests via tunnel                          ││
│  │  • frpc maintains persistent connection to frps                         ││
│  │  • App monitors frpc health, restarts if needed                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  APP SHUTDOWN                                                           ││
│  │  1. User closes Desktop App (or system shutdown)                        ││
│  │  2. App stops frpc daemon (SIGTERM)                                     ││
│  │  3. Tunnel terminates                                                   ││
│  │  4. Builders receive 503/timeout for requests to this user              ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. API Specification

### 8.1 Token Service API

The Token Service can be a new standalone service or integrated into the existing Gateway.

#### 8.1.1 POST /v1/tunnel/token

Request a tunnel token for frpc authentication.

**Request:**

```http
POST /v1/tunnel/token
Content-Type: application/json

{
  "walletAddress": "0xABC1234567890abcdef1234567890abcdef1234",
  "timestamp": 1707091200,
  "signature": "0x..."
}
```

**Signature Message (EIP-191):**

```
Sign this message to authorize tunnel access for your Vana Personal Server.

Wallet: 0xABC1234567890abcdef1234567890abcdef1234
Timestamp: 1707091200
```

**Response (200 OK):**

```json
{
  "token": "frp_MHhhYmMxMjM0NTY3ODkw_1707091200_a1b2c3d4e5f6...",
  "subdomain": "0xabc1234567890abcdef1234567890abcdef1234",
  "serverAddr": "proxy.server.vana.org",
  "serverPort": 7000,
  "expiresAt": "2026-02-05T00:00:00Z"
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `INVALID_SIGNATURE` | Signature verification failed |
| 400 | `INVALID_TIMESTAMP` | Timestamp too old or in future |
| 429 | `RATE_LIMITED` | Too many token requests (future) |
| 500 | `INTERNAL_ERROR` | Server error |

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
# Generate secure tokens
AUTH_TOKEN=$(openssl rand -hex 32)
DASHBOARD_PASS=$(openssl rand -hex 16)

cat > ${FRP_DIR}/frps.env << EOF
FRP_AUTH_TOKEN=${AUTH_TOKEN}
DASHBOARD_PASSWORD=${DASHBOARD_PASS}
EOF
chmod 600 ${FRP_DIR}/frps.env

echo "=== IMPORTANT: Save these credentials ==="
echo "FRP_AUTH_TOKEN: ${AUTH_TOKEN}"
echo "DASHBOARD_PASSWORD: ${DASHBOARD_PASS}"
echo "========================================="

# 8. Start service
echo "[8/8] Starting frps service..."
systemctl daemon-reload
systemctl enable frps
systemctl start frps
systemctl status frps

echo "=== Deployment Complete ==="
echo "frps is running on ports 7000 (control) and 443 (HTTPS proxy)"
```

### 9.2 Cloudflare Origin Certificate Setup

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

### 9.3 Upgrade Procedure

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

### 9.4 Rollback Procedure

```bash
#!/bin/bash
# rollback-frps.sh - Rollback FRP server

systemctl stop frps
cp /usr/local/bin/frps.bak /usr/local/bin/frps
systemctl start frps
systemctl status frps
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

Create a simple health check endpoint by tunneling a health service:

```bash
# On the frps server, run a simple health responder
# Or check frps process status via systemd
systemctl is-active frps
```

### 10.2 Metrics (MVP)

For MVP, collect basic metrics via logs and simple scripts:

| Metric | Collection Method | Alert Threshold |
|--------|-------------------|-----------------|
| frps process up | `systemctl is-active` | Process not active |
| Active tunnels | Parse dashboard or logs | N/A (informational) |
| CPU usage | `top` / `ps` | > 80% sustained |
| Memory usage | `free` / `ps` | > 80% of available |
| Disk usage | `df` | > 90% |
| Connection errors | Parse frps.log | > 10/min |

### 10.3 Logging

#### 10.3.1 Log Locations

| Log | Path | Rotation |
|-----|------|----------|
| frps application | `/var/log/frp/frps.log` | 7 days (frps config) |
| systemd journal | `journalctl -u frps` | systemd default |

#### 10.3.2 Log Parsing

```bash
# Count active connections
grep "new proxy" /var/log/frp/frps.log | wc -l

# Find connection errors
grep -i "error" /var/log/frp/frps.log | tail -20

# Watch real-time logs
journalctl -u frps -f
```

### 10.4 Alerting (MVP)

Simple cron-based alerting for MVP:

```bash
#!/bin/bash
# /etc/cron.d/frps-monitor

# Check every 5 minutes
*/5 * * * * root /opt/scripts/check-frps.sh

# check-frps.sh:
#!/bin/bash
if ! systemctl is-active --quiet frps; then
  # Send alert (email, Slack, PagerDuty, etc.)
  curl -X POST "https://hooks.slack.com/services/..." \
    -H "Content-Type: application/json" \
    -d '{"text":"ALERT: frps is down on proxy.server.vana.org"}'

  # Attempt restart
  systemctl restart frps
fi
```

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
│  Phase 2: Token Service (2-3 days)                                           │
│  ├── Token generation endpoint                                               │
│  ├── Wallet signature verification                                           │
│  └── Integration with Gateway (or standalone)                                │
│                                                                              │
│  Phase 3: Desktop Integration (2-3 days)                                     │
│  ├── frpc binary bundling                                                    │
│  ├── TunnelManager implementation                                            │
│  ├── Token request flow                                                      │
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

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| 1.1 | Create GCP project and enable APIs | Infra | [ ] |
| 1.2 | Reserve static external IP | Infra | [ ] |
| 1.3 | Create Compute Engine VM | Infra | [ ] |
| 1.4 | Configure firewall rules | Infra | [ ] |
| 1.5 | Add Cloudflare DNS records | Infra | [ ] |
| 1.6 | Configure Cloudflare SSL/TLS | Infra | [ ] |
| 1.7 | Generate Origin Certificate | Infra | [ ] |
| 1.8 | Deploy frps with initial config | Infra | [ ] |
| 1.9 | Verify tunnel routing works | Infra | [ ] |
| 1.10 | Set up basic monitoring | Infra | [ ] |

#### Phase 2: Token Service (2-3 days)

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| 2.1 | Design token format and signing | Backend | [ ] |
| 2.2 | Implement `/v1/tunnel/token` endpoint | Backend | [ ] |
| 2.3 | Implement EIP-191 signature verification | Backend | [ ] |
| 2.4 | Add token validation to frps (if custom) | Backend | [ ] |
| 2.5 | Deploy Token Service | Backend | [ ] |
| 2.6 | Integration testing | Backend | [ ] |

#### Phase 3: Desktop Integration (2-3 days)

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| 3.1 | Bundle frpc binaries for all platforms | Desktop | [ ] |
| 3.2 | Implement TunnelManager class | Desktop | [ ] |
| 3.3 | Implement token request flow | Desktop | [ ] |
| 3.4 | Add tunnel status to Desktop UI | Desktop | [ ] |
| 3.5 | Handle tunnel reconnection | Desktop | [ ] |
| 3.6 | Update DataPortabilityServers on connect | Desktop | [ ] |

#### Phase 4: Testing & Hardening (2-3 days)

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| 4.1 | End-to-end test: Desktop → frps → Builder | QA | [ ] |
| 4.2 | Load test: 100+ concurrent tunnels | QA | [ ] |
| 4.3 | Security review: token handling, TLS | Security | [ ] |
| 4.4 | Failure scenario testing | QA | [ ] |
| 4.5 | Write operational runbook | Infra | [ ] |
| 4.6 | Update protocol documentation | Docs | [ ] |

### 11.3 Dependencies

```
Phase 1 (Infrastructure)
    │
    ├──▶ Phase 2 (Token Service) ──┐
    │                              │
    └──▶ Phase 3 (Desktop) ────────┼──▶ Phase 4 (Testing)
                                   │
         (can start in parallel    │
          after Phase 1 complete)  │
```

---

## 12. Cost Estimation

### 12.1 GCP Costs (Monthly)

| Resource | Spec | Cost/Month |
|----------|------|------------|
| Compute Engine | e2-medium (2 vCPU, 4 GB) | ~$25 |
| Static IP | 1 address | ~$3 |
| Egress | 100 GB (estimated) | ~$8 |
| Persistent Disk | 20 GB SSD | ~$3 |
| **Total GCP** | | **~$40/month** |

### 12.2 Cloudflare Costs

| Resource | Tier | Cost/Month |
|----------|------|------------|
| DNS | Free | $0 |
| SSL/TLS | Free (Universal) | $0 |
| DDoS Protection | Free (basic) | $0 |
| **Total Cloudflare** | | **$0/month** |

### 12.3 Total MVP Cost

| Category | Cost/Month |
|----------|------------|
| GCP Infrastructure | ~$40 |
| Cloudflare | $0 |
| **Total** | **~$40/month** |

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

| Limit | Value |
|-------|-------|
| Requests/minute/user | 1000 |
| Bandwidth/hour/user | 1 GB |
| Concurrent connections/user | 100 |

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

| frps Version | frpc Version | Notes |
|--------------|--------------|-------|
| 0.58.x | 0.58.x | Current recommended |
| 0.57.x | 0.57.x | Compatible |
| 0.56.x | 0.56.x | Compatible |

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

# Test port connectivity
nc -zv proxy.server.vana.org 7000
```

#### B.2 SSL/TLS Errors

```bash
# Verify Cloudflare SSL mode is "Full (strict)"
# Verify origin certificate is valid
openssl x509 -in /etc/frp/certs/server.crt -text -noout

# Check certificate chain
curl -vI https://test.server.vana.org 2>&1 | grep -A 5 "SSL certificate"
```

#### B.3 High Latency

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
- [Cloudflare Origin Certificates](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [GCP Compute Engine](https://cloud.google.com/compute/docs)
- [Data Portability Protocol Spec](./260121-data-portability-protocol-spec.md)
- [Personal Server Scaffold](./260127-personal-server-scaffold.md)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-02-04 | Claude | Initial draft |
