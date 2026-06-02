# MPC Wallet -- Trusted Registry Integration Guide

This document describes how an MPC wallet cloud console application can consume the **Trusted Node Registry** published at GitHub as its source of truth for authorized MPC custody nodes.

---

## 1. Overview

The MPC wallet needs to know **which nodes are legitimate** before participating in key-generation or signing ceremonies. Instead of hardcoding node lists, the wallet fetches a cryptographically signed `registry.json` from the trusted registry's GitHub repository and verifies it locally.

```
+----------------+       HTTPS / raw.githubusercontent.com       +-----------------------+
|  MPC Wallet    | ---------------------------------------------- |  GitHub Repository    |
|  Cloud App     |   GET /data/registry.json                      |  (trusted-registry)   |
+-------+--------+                                                +-----------------------+
        |
        |  1. Fetch registry.json (primary URL or mirrors)
        |  2. Verify document integrity (hash, merkle, chain, role-based signatures)
        |  3. Check ceremony_config, trusted_infrastructure
        |  4. Extract active nodes by role
        |  5. Fetch each node's current ephemeral pubkey out-of-band, verified by ik_pub
        |
```

---

## 2. Registry Document Structure (v2)

The `registry.json` file contains a single `RegistryDocument` with nested sections:

```jsonc
{
  "registry_metadata": {
    "registry_id":       "dev-custody-v1",        // unique registry identifier
    "version":           3,                        // monotonically increasing
    "issued_at":         1710000000,               // unix timestamp (seconds)
    "expires_at":        1712592000,               // unix timestamp (seconds)
    "updated_at":        "2026-03-12T10:30:00.000Z", // ISO timestamp
    "document_hash":     "sha256-hex...",          // SHA-256 of deterministic JSON
    "merkle_root":       "sha256-hex...",          // Merkle root of nodes list
    "prev_document_hash": "sha256-hex... | null",  // null for genesis (v1)
    "endpoints": {                                 // where clients can fetch registry updates (or null)
      "primary":    "https://raw.githubusercontent.com/zozzozm/trusted-registery/main/data/registry.json",
      "mirrors":    ["https://mirror-1.custody.internal/registry.json"]
    }
  },
  "governance": {
    "roles": [
      {
        "role":          "SYSTEM_ADMIN",           // GovernanceRoleName (closed set)
        "display_name":  "System Administrator",
        "addresses":     ["0xAbc...", "0xDef...", "0x123..."],  // Ethereum addresses
        "quorum":        2,                        // minimum signatures required for this role
        "features":      {}                        // role-specific feature flags
      }
    ]
  },
  "ceremony_config": {
    "allowed_protocols":    ["cmp"],               // MPC protocols allowed
    "allowed_curves":       ["Secp256k1"]          // elliptic curves allowed
  },
  "trusted_infrastructure": {
    "market_oracle_pubkey":     ["95aa86a98d90f6d01407219eb951890c465320015cd2f2f8a23df6671e8fbb68"],  // 32-byte hex pubkeys (64 hex chars, no 0x)
    "trusted_binary_hashes":    ["sha256-hex..."]  // hashes of trusted binaries
  },
  "nodes": [
    {
      "node_id":      "sha256-derived-id",
      "ik_pub":       "64-hex-char-identity-key",   // Ed25519 identity public key
      "role":         "USER_COSIGNER",               // USER_COSIGNER | PROVIDER_COSIGNER | RECOVERY_GUARDIAN
      "status":       "ACTIVE",                      // ACTIVE | REVOKED | MAINTENANCE
      "enrolled_at":  1710000000,
      "updated_at":   1710000000,
      "revoked_at":   null
    }
  ],
  "signatures": [
    {
      "role":      "SYSTEM_ADMIN",                 // governance role name
      "signer":    "0xAbc...",                     // Ethereum address of signer
      "signature": "0x...130-hex-chars..."         // EIP-712 v2 typed data signature
    }
  ]
}
```

### Node Roles

| Role | Description |
|------|-------------|
| `USER_COSIGNER` | The user's device/key-share holder |
| `PROVIDER_COSIGNER` | The cloud service's key-share holder |
| `RECOVERY_GUARDIAN` | Backup signer used for recovery flows |

### Ephemeral Keys (Not in Registry)

The registry stores only `ik_pub` (long-lived identity key, Ed25519). Ephemeral / handshake / pre-key material is **not** stored on-chain in the document because it rotates too frequently to justify a governance-signed version bump.

At ceremony time the wallet fetches each participating node's current ephemeral pubkey out-of-band (HTTPS to the node, gossip, etc.) and verifies it was signed by the node's `ik_pub` before using it for the Diffie–Hellman handshake. This gives forward secrecy on session traffic while keeping the registry slow-changing.

### Governance Roles

| Role | Required | Min Addresses | Description |
|------|----------|---------------|-------------|
| `SYSTEM_ADMIN` | Yes | 3 (quorum >= 2) | Full administrative control |
| `POLICY_COMPLIANCE` | No | - | Compliance and policy team |
| `TREASURY_OPS` | No | - | Treasury operations |
| `AUDIT_OBSERVER` | No | - | Audit observation |

### Endpoints

The `registry_metadata.endpoints` object tells clients where to fetch the registry:
- `primary` -- the main URL (e.g., GitHub raw URL)
- `mirrors` -- fallback URLs for redundancy
- The entire `endpoints` object is signed by the governance roles, so it cannot be tampered with

### Ceremony Config

The `ceremony_config` object controls which cryptographic parameters are allowed for MPC ceremonies:
- `allowed_protocols` -- list of allowed MPC protocols (e.g. `["cmp"]`)
- `allowed_curves` -- list of allowed elliptic curves (e.g. `["Secp256k1"]`)
- The entire `ceremony_config` object is covered by the document hash and role-based signatures, so changes require multi-role quorum approval

### Trusted Infrastructure

The `trusted_infrastructure` section contains addresses and hashes for infrastructure components:
- `market_oracle_pubkey` -- array of 32-byte hex pubkeys (64 hex chars, no `0x` prefix) for approved price oracles (may be empty). Verify oracle-signed prices against one of these pubkeys (e.g. Ed25519).
- `trusted_binary_hashes` -- SHA-256 hashes of trusted node binaries

---

## 3. Fetching the Registry

### Using Endpoints from the Document

If you already have a cached registry, use its `registry_metadata.endpoints` field:

```typescript
async function fetchRegistry(cachedDoc?: RegistryDocument): Promise<RegistryDocument> {
  const urls: string[] = [];

  if (cachedDoc?.registry_metadata?.endpoints) {
    urls.push(cachedDoc.registry_metadata.endpoints.primary);
    urls.push(...(cachedDoc.registry_metadata.endpoints.mirrors || []));
  } else {
    // Bootstrap URL -- hardcoded for first fetch
    urls.push('https://raw.githubusercontent.com/zozzozm/trusted-registery/main/data/registry.json');
  }

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      continue; // try next mirror
    }
  }

  throw new Error('Failed to fetch registry from all endpoints');
}
```

### Caching Strategy

- **Poll interval**: Fetch every 5-15 minutes, or on wallet boot.
- **Cache locally**: Store the last valid document on disk as a fallback.
- **Version check**: Only process if `registry_metadata.version` > your cached version.
- **Expiry**: Reject documents where `Date.now()/1000 > registry_metadata.expires_at`.
- **Endpoint discovery**: After successful verification, update your fetch URLs from the document's `registry_metadata.endpoints` field.

---

## 4. Verification (REQUIRED)

**Never trust the registry without verification.** The wallet must run these checks before using any node data.

### 4.1 -- Trust Root: Governance Roles

Hardcode or securely configure the SYSTEM_ADMIN Ethereum addresses in your wallet app. These are the **only** trust anchors for genesis verification. For subsequent versions, trust is derived from the previous version's governance roles.

```typescript
// These are the SYSTEM_ADMIN addresses authorized to sign the genesis registry.
// Obtain these out-of-band from the registry operators.
const TRUSTED_SYSTEM_ADMIN_ADDRESSES = [
  '0xAbc...', // Admin 0
  '0xDef...', // Admin 1
  '0x123...', // Admin 2
];

const SYSTEM_ADMIN_QUORUM = 2; // 2-of-3 multi-sig for SYSTEM_ADMIN
```

### 4.2 -- Verification Steps

```typescript
import { createHash } from 'crypto';
import { ethers } from 'ethers';

// -- Step 1: Structure check -----------------------------------------------
function checkStructure(doc: any): void {
  const requiredSections = [
    'registry_metadata', 'governance', 'ceremony_config',
    'trusted_infrastructure', 'nodes', 'signatures',
  ];
  const missing = requiredSections.filter(f => doc[f] === undefined);
  if (missing.length) throw new Error(`Missing sections: ${missing.join(', ')}`);

  const meta = doc.registry_metadata;
  const metaFields = [
    'registry_id', 'version', 'issued_at', 'expires_at',
    'document_hash', 'merkle_root', 'prev_document_hash',
  ];
  const missingMeta = metaFields.filter(f => meta[f] === undefined);
  if (missingMeta.length) throw new Error(`Missing metadata fields: ${missingMeta.join(', ')}`);
}

// -- Step 2: Expiry check --------------------------------------------------
function checkExpiry(doc: RegistryDocument): void {
  const now = Math.floor(Date.now() / 1000);
  if (now > doc.registry_metadata.expires_at) {
    throw new Error(`Registry expired at ${new Date(doc.registry_metadata.expires_at * 1000).toISOString()}`);
  }
}

// -- Step 3: Document hash integrity ---------------------------------------
function deterministicHash(obj: object): string {
  const canonical = JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return v;
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function checkDocumentHash(doc: RegistryDocument): void {
  const { signatures, ...body } = doc;
  const bodyWithEmptyHash = {
    ...body,
    registry_metadata: { ...body.registry_metadata, document_hash: '' },
  };
  const expected = deterministicHash(bodyWithEmptyHash);
  if (expected !== doc.registry_metadata.document_hash) {
    throw new Error('Document hash mismatch -- content has been tampered with');
  }
}

// -- Step 4: Merkle root verification --------------------------------------
function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function buildMerkleTree(leaves: string[]): string[] {
  if (leaves.length === 1) return leaves;
  const next: string[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const right = i + 1 < leaves.length ? leaves[i + 1] : leaves[i];
    next.push(hashString('node:' + leaves[i] + ':' + right));
  }
  return buildMerkleTree(next);
}

function checkMerkleRoot(doc: RegistryDocument): void {
  const sorted = [...doc.nodes].sort((a, b) => a.node_id.localeCompare(b.node_id));
  let expected: string;
  if (sorted.length === 0) {
    expected = hashString('empty');
  } else {
    const leaves = sorted.map(n => hashString('leaf:' + deterministicHash(n)));
    expected = buildMerkleTree(leaves)[0];
  }
  if (expected !== doc.registry_metadata.merkle_root) {
    throw new Error('Merkle root mismatch -- node list has been tampered with');
  }
}

// -- Step 5: EIP-712 role-based signature verification ---------------------
const EIP712_DOMAIN = { name: 'MPC Node Registry', version: '2' };

const EIP712_TYPES = {
  Endpoints: [
    { name: 'primary', type: 'string' },
    { name: 'mirrors', type: 'string[]' },
  ],
  RegistryMetadata: [
    { name: 'registry_id',        type: 'string' },
    { name: 'version',            type: 'uint256' },
    { name: 'issued_at',          type: 'uint256' },
    { name: 'expires_at',         type: 'uint256' },
    { name: 'updated_at',         type: 'string' },
    { name: 'document_hash',      type: 'string' },
    { name: 'merkle_root',        type: 'string' },
    { name: 'prev_document_hash', type: 'string' },
    { name: 'endpoints',          type: 'Endpoints' },
  ],
  GovernanceRole: [
    { name: 'role',          type: 'string' },
    { name: 'display_name',  type: 'string' },
    { name: 'addresses',     type: 'address[]' },
    { name: 'quorum',        type: 'uint256' },
    { name: 'features_json', type: 'string' },
  ],
  CeremonyConfig: [
    { name: 'allowed_protocols',   type: 'string[]' },
    { name: 'allowed_curves',      type: 'string[]' },
  ],
  TrustedInfrastructure: [
    { name: 'market_oracle_pubkey',      type: 'string[]' },
    { name: 'trusted_binary_hashes',      type: 'string[]' },
  ],
  NodeRecord: [
    { name: 'node_id',      type: 'string' },
    { name: 'ik_pub',       type: 'string' },
    { name: 'role',          type: 'string' },
    { name: 'status',        type: 'string' },
    { name: 'enrolled_at',   type: 'uint256' },
    { name: 'updated_at',    type: 'uint256' },
    { name: 'revoked_at',    type: 'uint256' },
  ],
  RegistryDocument: [
    { name: 'registry_metadata',      type: 'RegistryMetadata' },
    { name: 'governance',             type: 'GovernanceRole[]' },
    { name: 'ceremony_config',        type: 'CeremonyConfig' },
    { name: 'trusted_infrastructure', type: 'TrustedInfrastructure' },
    { name: 'nodes',                  type: 'NodeRecord[]' },
  ],
};

function checkSignatures(doc: RegistryDocument, trustedRoles: GovernanceRole[]): void {
  // For each governance role, verify that its quorum is met
  for (const role of trustedRoles) {
    const roleSigs = doc.signatures.filter(s => s.role === role.role);
    if (roleSigs.length < role.quorum) {
      throw new Error(`${role.role}: need ${role.quorum} signatures, got ${roleSigs.length}`);
    }

    const trustedSet = new Set(role.addresses.map(a => a.toLowerCase()));
    const seen = new Set<string>();

    // Build EIP-712 typed data value from the document
    const value = buildTypedDataValue(doc);

    for (const sig of roleSigs) {
      const addr = sig.signer.toLowerCase();

      if (seen.has(addr)) throw new Error(`Duplicate signer in ${role.role}`);
      seen.add(addr);

      if (!trustedSet.has(addr)) throw new Error(`Signer ${sig.signer} not in ${role.role} addresses`);

      // Recover signer via EIP-712
      const recovered = ethers.verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, value, sig.signature);
      if (recovered.toLowerCase() !== addr) {
        throw new Error(`Signature verification failed for ${sig.signer} in ${role.role}`);
      }
    }
  }
}

function buildTypedDataValue(doc: RegistryDocument): object {
  const meta = doc.registry_metadata;
  return {
    registry_metadata: {
      registry_id:        meta.registry_id,
      version:            meta.version,
      issued_at:          meta.issued_at,
      expires_at:         meta.expires_at,
      updated_at:         meta.updated_at ?? '',
      document_hash:      meta.document_hash,
      merkle_root:        meta.merkle_root,
      prev_document_hash: meta.prev_document_hash ?? '',
      endpoints: meta.endpoints
        ? { primary: meta.endpoints.primary, mirrors: meta.endpoints.mirrors }
        : { primary: '', mirrors: [] },
    },
    governance: doc.governance.roles.map(r => ({
      role:          r.role,
      display_name:  r.display_name,
      addresses:     r.addresses,
      quorum:        r.quorum,
      features_json: JSON.stringify(r.features ?? {}),
    })),
    ceremony_config: {
      allowed_protocols:   doc.ceremony_config.allowed_protocols,
      allowed_curves:      doc.ceremony_config.allowed_curves,
    },
    trusted_infrastructure: {
      market_oracle_pubkey:      doc.trusted_infrastructure.market_oracle_pubkey ?? [],
      trusted_binary_hashes:      doc.trusted_infrastructure.trusted_binary_hashes,
    },
    nodes: doc.nodes.map(n => ({
      node_id:      n.node_id,
      ik_pub:       n.ik_pub,
      role:         n.role,
      status:       n.status,
      enrolled_at:  n.enrolled_at,
      updated_at:   n.updated_at ?? 0,
      revoked_at:   n.revoked_at ?? 0,
    })),
  };
}

// -- Step 6: Ceremony config check -----------------------------------------
function checkCeremonyConfig(doc: RegistryDocument): void {
  const cc = doc.ceremony_config;
  if (!cc) throw new Error('ceremony_config is required');
  if (!Array.isArray(cc.allowed_curves) || cc.allowed_curves.length === 0) {
    throw new Error('allowed_curves must be a non-empty array');
  }
  if (!Array.isArray(cc.allowed_protocols) || cc.allowed_protocols.length === 0) {
    throw new Error('allowed_protocols must be a non-empty array');
  }
}

// -- Step 7: Endpoints check -----------------------------------------------
function checkEndpoints(doc: RegistryDocument): void {
  const endpoints = doc.registry_metadata.endpoints;
  if (!endpoints) return; // endpoints are optional

  const urlPattern = /^https?:\/\/.+/;
  if (!urlPattern.test(endpoints.primary)) {
    throw new Error(`Invalid primary endpoint URL: ${endpoints.primary}`);
  }
  for (const mirror of endpoints.mirrors) {
    if (!urlPattern.test(mirror)) {
      throw new Error(`Invalid mirror URL: ${mirror}`);
    }
  }
  const allUrls = [endpoints.primary, ...endpoints.mirrors];
  if (new Set(allUrls).size !== allUrls.length) {
    throw new Error('Duplicate URLs in endpoints');
  }
}

// -- Step 8: Trusted infrastructure check ----------------------------------
function checkTrustedInfrastructure(doc: RegistryDocument): void {
  const ti = doc.trusted_infrastructure;
  if (!ti) throw new Error('trusted_infrastructure is required');

  const oraclePkPattern = /^[0-9a-fA-F]{64}$/;
  if (!Array.isArray(ti.market_oracle_pubkey)) {
    throw new Error('market_oracle_pubkey must be an array');
  }
  for (const pk of ti.market_oracle_pubkey) {
    if (!oraclePkPattern.test(pk)) {
      throw new Error(`Invalid market_oracle_pubkey entry: ${pk} (must be 64 hex chars)`);
    }
  }
  for (const hash of ti.trusted_binary_hashes) {
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error(`Invalid binary hash format: ${hash}`);
    }
  }
}
```

### 4.3 -- Full Verification Function

```typescript
function verifyRegistry(doc: RegistryDocument, trustedRoles: GovernanceRole[]): void {
  checkStructure(doc);
  checkExpiry(doc);
  checkDocumentHash(doc);
  checkMerkleRoot(doc);
  checkSignatures(doc, trustedRoles);
  checkCeremonyConfig(doc);
  checkEndpoints(doc);
  checkTrustedInfrastructure(doc);
  // All checks passed -- document is authentic and untampered
}
```

---

## 5. Using the Registry in the MPC Wallet

### 5.1 -- Get Active Nodes

```typescript
function getActiveNodes(doc: RegistryDocument): NodeRecord[] {
  return doc.nodes.filter(n => n.status === 'ACTIVE');
}
```

### 5.2 -- Get Nodes by Role

```typescript
function getNodesByRole(
  doc: RegistryDocument,
  role: 'USER_COSIGNER' | 'PROVIDER_COSIGNER' | 'RECOVERY_GUARDIAN',
): NodeRecord[] {
  return doc.nodes.filter(
    n => n.status === 'ACTIVE' && n.role === role,
  );
}
```

### 5.3 -- MPC Ceremony Integration

```typescript
async function startSigningCeremony(txPayload: any) {
  // 1. Fetch and verify registry
  const registry = await fetchRegistry();
  const trustedRoles = getTrustedRoles(); // from cached previous version or genesis
  verifyRegistry(registry, trustedRoles);

  // 2. Resolve the signing quorum
  const userNode     = getNodesByRole(registry, 'USER_COSIGNER')[0];
  const providerNode = getNodesByRole(registry, 'PROVIDER_COSIGNER')[0];

  if (!userNode || !providerNode) {
    throw new Error('Missing required cosigners for this wallet');
  }

  // 3. For each node, fetch its current ephemeral pubkey out-of-band and verify it
  //    against the node's registry-anchored ik_pub.
  const userEphem     = await fetchAndVerifyEphemeralPubkey(userNode);
  const providerEphem = await fetchAndVerifyEphemeralPubkey(providerNode);

  // 4. Establish encrypted channels with the authenticated ephemeral keys.
  const participants = [
    { node_id: userNode.node_id,     ik_pub: userNode.ik_pub,     ek_pub: userEphem },
    { node_id: providerNode.node_id, ik_pub: providerNode.ik_pub, ek_pub: providerEphem },
  ];

  // ... initiate MPC signing protocol with these participants
}
```

### 5.4 -- Using Approved Oracle Pubkeys

```typescript
function getApprovedOracles(doc: RegistryDocument): string[] {
  return doc.trusted_infrastructure.market_oracle_pubkey; // 32-byte hex pubkeys (64 chars, no 0x)
}

function isApprovedOracle(doc: RegistryDocument, oraclePubkey: string): boolean {
  const approved = getApprovedOracles(doc).map(k => k.toLowerCase());
  return approved.includes(oraclePubkey.toLowerCase());
}
```

When you receive a price feed, verify the oracle's signature (Ed25519 or equivalent) over the payload against one of these pubkeys before trusting the price.

---

## 6. High-Water Mark (Rollback Protection)

To prevent an attacker from serving a stale (older) registry version, the wallet should track the highest version it has seen:

```typescript
interface HighWaterMark {
  registry_id:   string;
  max_version:   number;
  last_doc_hash: string;
  updated_at:    number;
}

function checkRollback(doc: RegistryDocument, hwm: HighWaterMark | null): void {
  if (!hwm) return; // first fetch, nothing to compare

  if (doc.registry_metadata.registry_id !== hwm.registry_id) {
    throw new Error('Registry ID changed -- possible substitution attack');
  }
  if (doc.registry_metadata.version < hwm.max_version) {
    throw new Error(`Rollback detected: got v${doc.registry_metadata.version}, expected >= v${hwm.max_version}`);
  }
}

function updateHighWaterMark(doc: RegistryDocument): HighWaterMark {
  return {
    registry_id:   doc.registry_metadata.registry_id,
    max_version:   doc.registry_metadata.version,
    last_doc_hash: doc.registry_metadata.document_hash,
    updated_at:    Math.floor(Date.now() / 1000),
  };
}
```

---

## 7. Hash Chain Verification (Optional, Recommended)

If your wallet caches previous documents, verify the hash chain links:

```typescript
function checkHashChain(
  newDoc: RegistryDocument,
  previousDoc: RegistryDocument | null,
): void {
  if (!previousDoc) {
    // Genesis document -- prev_document_hash must be null
    if (newDoc.registry_metadata.prev_document_hash !== null) {
      throw new Error('Genesis document must have null prev_document_hash');
    }
    return;
  }

  if (newDoc.registry_metadata.prev_document_hash !== previousDoc.registry_metadata.document_hash) {
    throw new Error('Hash chain broken -- prev_document_hash does not match previous document');
  }

  if (newDoc.registry_metadata.version !== previousDoc.registry_metadata.version + 1) {
    throw new Error(`Version gap: expected ${previousDoc.registry_metadata.version + 1}, got ${newDoc.registry_metadata.version}`);
  }
}
```

---

## 7.5. Version Chain Walk (Gap Recovery)

If the wallet goes offline during a governance role rotation, the latest registry may be signed by role addresses the wallet doesn't trust. The **version chain** allows automatic recovery by fetching intermediate versions and replaying trust transitions.

### Version File URL Pattern

Version files are stored alongside `registry.json`:

```
primary:  https://raw.githubusercontent.com/.../data/registry.json
version:  https://raw.githubusercontent.com/.../data/versions/{N}.json
```

Derive the URL by replacing `registry.json` with `versions/{N}.json`.

### Chain-Walk Algorithm

```typescript
async function syncRegistry(
  cachedDoc: RegistryDocument,
  latestDoc: RegistryDocument,
  baseUrl: string,
): Promise<RegistryDocument> {
  // No gap -- direct verification
  if (latestDoc.registry_metadata.version === cachedDoc.registry_metadata.version + 1) {
    verifyRegistry(latestDoc, cachedDoc.governance.roles);
    return latestDoc;
  }

  if (latestDoc.registry_metadata.version <= cachedDoc.registry_metadata.version) {
    throw new Error('Rollback detected');
  }

  // Gap detected -- walk the chain
  let trustedRoles = cachedDoc.governance.roles;
  let prevHash = cachedDoc.registry_metadata.document_hash;

  for (let v = cachedDoc.registry_metadata.version + 1; v <= latestDoc.registry_metadata.version; v++) {
    const url = baseUrl.replace('registry.json', `versions/${v}.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Missing intermediate version v${v}`);

    const doc: RegistryDocument = await res.json();
    if (doc.registry_metadata.version !== v) throw new Error(`Version mismatch in v${v}`);
    if (doc.registry_metadata.prev_document_hash !== prevHash) throw new Error(`Hash chain broken at v${v}`);

    checkDocumentHash(doc);
    checkMerkleRoot(doc);
    // Verify signatures against current trusted roles (not the doc's own roles)
    checkSignatures(doc, trustedRoles);

    // Trust transition -- adopt this version's governance roles
    trustedRoles = doc.governance.roles;
    prevHash = doc.registry_metadata.document_hash;
  }

  return latestDoc;
}
```

### Updated Fetch Flow

```
1. Fetch registry.json from primary endpoint
2. If fetch fails, try mirrors; if all fail, use cached version
3. If latest.version == cached.version -> no update
4. If latest.version < cached.version -> rollback detected, reject
5. If latest.version == cached.version + 1 -> verify directly against cached roles
6. If latest.version > cached.version + 1 -> chain-walk via versions/
7. On any failure -> keep cached version, retry on next poll
```

---

## 8. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| **GitHub compromise** | Registry is cryptographically signed. Even if GitHub is compromised, forged documents will fail signature verification. |
| **Single role key compromise** | Per-role quorum means a single compromised key within a role cannot produce a valid document. SYSTEM_ADMIN requires 2-of-3 quorum. |
| **Cross-role collusion** | All governance roles from the previous version must sign. Compromising one role is insufficient. |
| **Rollback attack** | High-water mark tracking prevents serving old documents. |
| **Expired registry** | Always check `registry_metadata.expires_at`. Refuse to use expired documents. |
| **Man-in-the-middle** | HTTPS + EIP-712 v2 signature verification. Endpoints are signed in the document. |
| **Node key rotation** | When a node is revoked, its `status` changes to `REVOKED`. Nodes under maintenance have `MAINTENANCE` status. Always filter for `ACTIVE` nodes. |
| **Endpoint tampering** | Endpoint URLs are covered by the document hash and role-based signatures. Changing them requires multi-role quorum approval. |
| **Missed governance rotation** | Version chain walk recovers automatically -- no manual intervention needed. Fetch intermediate versions from `data/versions/` and replay trust transitions. |
| **Infrastructure spoofing** | `trusted_infrastructure` addresses are signed into the document. |

### Trust Root Summary

The wallet trusts **only** the hardcoded SYSTEM_ADMIN Ethereum addresses for genesis verification. After genesis, trust is derived from the previous version's governance roles:

```
Genesis SYSTEM_ADMIN Addresses (hardcoded)
  +-- verify EIP-712 v2 signatures on genesis document
        +-- governance.roles (trust root for version 2)
              +-- verify EIP-712 v2 signatures on version 2
                    +-- governance.roles (trust root for version 3)
                          +-- ... (chain continues)

Each version's signatures cover:
  +-- document_hash (SHA-256 integrity of all fields)
        +-- registry_metadata (version, expiry, merkle_root, endpoints)
        +-- governance.roles (role addresses and quorums)
        +-- ceremony_config (protocols, curves)
        +-- trusted_infrastructure (oracle addresses, binary hashes)
        +-- nodes[] (Merkle root integrity)
```

---

## 9. Dependencies

The wallet app needs these packages for verification:

```json
{
  "ethers": "^6.x"     // EIP-712 signature recovery
}
```

Node.js `crypto` module is used for SHA-256 hashing (built-in, no extra dependency).

---

## 10. TypeScript Types

Copy these types into your wallet project:

```typescript
type NodeRole   = 'USER_COSIGNER' | 'PROVIDER_COSIGNER' | 'RECOVERY_GUARDIAN';
type NodeStatus = 'ACTIVE' | 'REVOKED' | 'MAINTENANCE';

type GovernanceRoleName =
  | 'SYSTEM_ADMIN'
  | 'POLICY_COMPLIANCE'
  | 'TREASURY_OPS'
  | 'AUDIT_OBSERVER';

interface NodeRecord {
  node_id:        string;
  ik_pub:         string;
  role:           NodeRole;
  status:         NodeStatus;
  enrolled_at:    number;
  updated_at?:    number;
  revoked_at?:    number | null;
  ik_rotations?:  IkRotationEntry[];
}

interface IkRotationEntry {
  prev_ik_pub:  string;
  new_ik_pub:   string;
  rotated_at:   number;
  reason:       string;
  proof:        string;
}

interface GovernanceRole {
  role:          GovernanceRoleName;
  display_name:  string;
  addresses:     string[];
  quorum:        number;
  features:      Record<string, any>;
}

interface Governance {
  roles: GovernanceRole[];
}

interface RegistryEndpoints {
  primary: string;
  mirrors: string[];
}

interface RegistryMetadata {
  registry_id:        string;
  version:            number;
  issued_at:          number;
  expires_at:         number;
  updated_at:         string;
  document_hash:      string;
  merkle_root:        string;
  prev_document_hash: string | null;
  endpoints:          RegistryEndpoints | null;
}

interface CeremonyConfig {
  allowed_protocols:    string[];
  allowed_curves:       string[];
}

interface TrustedInfrastructure {
  market_oracle_pubkey:       string[];
  trusted_binary_hashes:      string[];
}

interface RoleSignature {
  role:       string;
  signer:     string;
  signature:  string;
}

interface RegistryDocument {
  registry_metadata:      RegistryMetadata;
  governance:             Governance;
  ceremony_config:        CeremonyConfig;
  trusted_infrastructure: TrustedInfrastructure;
  nodes:                  NodeRecord[];
  signatures:             RoleSignature[];
}

interface HighWaterMark {
  registry_id:   string;
  max_version:   number;
  last_doc_hash: string;
  updated_at:    number;
}
```

---

## 11. API Endpoints Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/registry/current` | Get current published document |
| `GET` | `/api/registry/health` | Health check with governance info |
| `GET` | `/api/registry/nodes` | List nodes (filter: `?role=`) |
| `GET` | `/api/registry/nodes/:node_id` | Get specific node |
| `POST` | `/api/registry/pending` | Create new draft |
| `GET` | `/api/registry/pending` | Get pending draft |
| `DELETE` | `/api/registry/pending` | Delete pending draft |
| `GET` | `/api/registry/pending/message` | Get EIP-712 v2 payload for signing |
| `POST` | `/api/registry/pending/sign` | Submit role-based signature `{role, signer, signature, document_hash}` |
| `POST` | `/api/registry/nodes/enroll` | Propose node enrollment |
| `POST` | `/api/registry/nodes/revoke` | Propose node revocation |
| `POST` | `/api/registry/nodes/rotate-ik` | Rotate node identity key |
| `POST` | `/api/registry/nodes/maintenance` | Set node to maintenance mode |
| `POST` | `/api/registry/nodes/reactivate` | Reactivate maintenance node |
| `POST` | `/api/registry/governance/role` | Propose governance role changes |
| `POST` | `/api/registry/ceremony-config/propose` | Propose ceremony configuration |
| `POST` | `/api/registry/infrastructure/propose` | Propose trusted infrastructure changes |
| `POST` | `/api/registry/endpoints/propose` | Propose endpoint URLs |
| `POST` | `/api/registry/verify` | Verify a document (11-step pipeline) |
| `POST` | `/api/registry/publish` | Publish signed document |
| `GET` | `/api/registry/versions` | List available version numbers |
| `GET` | `/api/registry/versions/:v` | Get a specific historical version |
| `GET` | `/api/registry/audit` | Get audit log |
