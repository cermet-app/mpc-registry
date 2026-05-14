#!/usr/bin/env ts-node
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/verify-file.ts — used by GitHub Actions to verify the registry file
//
// TRUST MODEL (role-based governance):
//   Genesis (v1) signatures are verified against the document's own governance roles.
//     SYSTEM_ADMIN role addresses must match ADMIN_ADDRESS_* env vars (external trust root).
//   Every subsequent version's signatures are verified against the PREVIOUS version's
//     governance roles — each role must meet its quorum using the previous version's addresses.
//   The full chain is walked from genesis to HEAD to prevent self-referential role injection.
var dotenv = require("dotenv");
dotenv.config();
var fs_1 = require("fs");
var path_1 = require("path");
var crypto_1 = require("../src/common/crypto");
var config_1 = require("../src/common/config");
/** Verify a single document's hash and merkle root integrity. */
function verifyIntegrity(doc, label) {
    // Document hash
    var savedHash = doc.registry_metadata.document_hash;
    var _ = doc.signatures, body = __rest(doc, ["signatures"]);
    var expected = (0, crypto_1.computeDocumentHash)(body);
    if (expected !== savedHash) {
        console.error("".concat(label, ": document hash mismatch"));
        process.exit(1);
    }
    // Merkle root
    var nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    var expectedRoot = (0, crypto_1.computeMerkleRoot)(nodes);
    if (expectedRoot !== doc.registry_metadata.merkle_root) {
        console.error("".concat(label, ": merkle root mismatch"));
        process.exit(1);
    }
}
/**
 * Verify signatures on a document against a set of governance roles.
 * Each role must meet its quorum — signatures are verified cryptographically.
 */
function verifyRoleSignatures(doc, roles, label) {
    var _ = doc.signatures, body = __rest(doc
    // Build the doc-for-signing (unsigned doc with document_hash set)
    , ["signatures"]);
    // Build the doc-for-signing (unsigned doc with document_hash set)
    var docForSigning = __assign(__assign({}, body), { registry_metadata: __assign({}, body.registry_metadata) });
    for (var _i = 0, roles_1 = roles; _i < roles_1.length; _i++) {
        var role = roles_1[_i];
        var result = (0, crypto_1.verifyRoleQuorum)(docForSigning, doc.signatures, role);
        if (!result.valid) {
            console.error("".concat(label, ": role quorum verification failed \u2014 ").concat(result.reason));
            process.exit(1);
        }
    }
}
/** Find the SYSTEM_ADMIN role in a document's governance. */
function getSystemAdminRole(doc) {
    return doc.governance.roles.find(function (r) { return r.role === 'SYSTEM_ADMIN'; });
}
function main() {
    var _a, _b, _c;
    var file = config_1.CONFIG.REGISTRY_FILE;
    var doc = JSON.parse((0, fs_1.readFileSync)(file, 'utf-8'));
    var versionsDir = (0, path_1.resolve)((0, path_1.dirname)(file), 'versions');
    var meta = doc.registry_metadata;
    var sysAdmin = getSystemAdminRole(doc);
    console.log("Verifying ".concat(file));
    console.log("  Registry: ".concat(meta.registry_id));
    console.log("  Version:  ".concat(meta.version));
    console.log("  Nodes:    ".concat((_b = (_a = doc.nodes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0));
    console.log("  Roles:    ".concat(doc.governance.roles.map(function (r) { return r.role; }).join(', ')));
    // Check registry ID
    if (meta.registry_id !== config_1.CONFIG.REGISTRY_ID) {
        console.error("Registry ID mismatch: ".concat(meta.registry_id, " !== ").concat(config_1.CONFIG.REGISTRY_ID));
        process.exit(1);
    }
    // Verify SYSTEM_ADMIN role exists and meets minimum requirements
    if (!sysAdmin) {
        console.error('Document is missing the SYSTEM_ADMIN governance role');
        process.exit(1);
    }
    if (sysAdmin.addresses.length < config_1.CONFIG.SYSTEM_ADMIN_MIN_ADDRESSES) {
        console.error("SYSTEM_ADMIN needs at least ".concat(config_1.CONFIG.SYSTEM_ADMIN_MIN_ADDRESSES, " addresses, ") +
            "got ".concat(sysAdmin.addresses.length));
        process.exit(1);
    }
    if (sysAdmin.quorum < config_1.CONFIG.SYSTEM_ADMIN_QUORUM) {
        console.error("SYSTEM_ADMIN quorum must be >= ".concat(config_1.CONFIG.SYSTEM_ADMIN_QUORUM, ", got ").concat(sysAdmin.quorum));
        process.exit(1);
    }
    // ── Establish trust root from env vars ──────────────────────────────────
    var genesisAddrs = config_1.CONFIG.GENESIS_ADMIN_ADDRESSES;
    if (genesisAddrs.length === 0) {
        console.error('ADMIN_ADDRESS_* env vars are required as the trust root for verification');
        process.exit(1);
    }
    // Load trust root addresses for all roles from env vars
    var trustRootByRole = {};
    for (var _i = 0, _d = Object.entries(config_1.CONFIG.GENESIS_ROLE_PREFIXES); _i < _d.length; _i++) {
        var _e = _d[_i], roleName = _e[0], prefix = _e[1];
        var addrs = config_1.CONFIG.getGenesisRoleAddresses(prefix);
        if (addrs.length > 0)
            trustRootByRole[roleName] = addrs;
    }
    console.log("  Trust root roles: ".concat(Object.keys(trustRootByRole).join(', ')));
    // Check expiry
    var now = Math.floor(Date.now() / 1000);
    if (now > meta.expires_at) {
        console.warn("Document expired \u2014 renew it!");
    }
    // ── Verify document integrity (hash + merkle) ──────────────────────────
    verifyIntegrity(doc, "v".concat(meta.version));
    console.log("  Document hash verified");
    console.log("  Merkle root verified");
    // ── Full chain-of-trust verification ───────────────────────────────────
    var currentVersion = meta.version;
    if (currentVersion === 1) {
        var _loop_1 = function (roleName, envAddrs) {
            var docRole = doc.governance.roles.find(function (r) { return r.role === roleName; });
            if (!docRole) {
                console.error("Genesis is missing ".concat(roleName, " role (expected from env vars)"));
                process.exit(1);
            }
            var docSet = new Set(docRole.addresses.map(function (a) { return a.toLowerCase(); }));
            var envSet = new Set(envAddrs.map(function (a) { return a.toLowerCase(); }));
            var allMatch = __spreadArray([], envSet, true).every(function (a) { return docSet.has(a); });
            if (!allMatch) {
                console.error("Genesis ".concat(roleName, " addresses do not match env vars (trust root)"));
                process.exit(1);
            }
            console.log("  Genesis ".concat(roleName, " addresses match trust root (env vars)"));
        };
        // Genesis: verify ALL roles that have env vars match the document
        for (var _f = 0, _g = Object.entries(trustRootByRole); _f < _g.length; _f++) {
            var _h = _g[_f], roleName = _h[0], envAddrs = _h[1];
            _loop_1(roleName, envAddrs);
        }
        // Genesis: verify signatures against the document's own roles
        verifyRoleSignatures(doc, doc.governance.roles, 'v1');
        console.log("  v1 role signatures verified against own governance roles");
    }
    else {
        // Version 2+: walk the full chain from v1
        console.log("\n  Walking chain of trust from v1 to v".concat(currentVersion, "..."));
        // Track the trusted governance roles from the previous version
        var trustedRoles = [];
        for (var v = 1; v <= currentVersion; v++) {
            var isHead = v === currentVersion;
            var vDoc = void 0;
            if (isHead) {
                vDoc = doc;
            }
            else {
                var vFile = (0, path_1.resolve)(versionsDir, "".concat(v, ".json"));
                if (!(0, fs_1.existsSync)(vFile)) {
                    console.error("  Missing version file ".concat(v, ".json \u2014 cannot verify chain of trust"));
                    process.exit(1);
                }
                vDoc = JSON.parse((0, fs_1.readFileSync)(vFile, 'utf-8'));
            }
            // Verify integrity of this version
            verifyIntegrity(vDoc, "v".concat(v));
            // For v1: verify ALL roles with env vars match the document
            if (v === 1) {
                var _loop_2 = function (roleName, envAddrs) {
                    var docRole = vDoc.governance.roles.find(function (r) { return r.role === roleName; });
                    if (!docRole) {
                        console.error("  v1 is missing ".concat(roleName, " role (expected from env vars)"));
                        process.exit(1);
                    }
                    var docSet = new Set(docRole.addresses.map(function (a) { return a.toLowerCase(); }));
                    var envSet = new Set(envAddrs.map(function (a) { return a.toLowerCase(); }));
                    var allMatch = __spreadArray([], envSet, true).every(function (a) { return docSet.has(a); });
                    if (!allMatch) {
                        console.error("  v1 ".concat(roleName, " addresses do not match trust root (env vars)"));
                        process.exit(1);
                    }
                };
                for (var _j = 0, _k = Object.entries(trustRootByRole); _j < _k.length; _j++) {
                    var _l = _k[_j], roleName = _l[0], envAddrs = _l[1];
                    _loop_2(roleName, envAddrs);
                }
                // Genesis verifies against its own roles
                verifyRoleSignatures(vDoc, vDoc.governance.roles, 'v1');
                console.log("    v1: role signatures verified against trust root (own roles)");
            }
            else {
                // Verify hash chain linkage
                var prevFile = (0, path_1.resolve)(versionsDir, "".concat(v - 1, ".json"));
                var prevDoc = JSON.parse((0, fs_1.readFileSync)(prevFile, 'utf-8'));
                if (vDoc.registry_metadata.prev_document_hash !== prevDoc.registry_metadata.document_hash) {
                    console.error("  Hash chain broken at v".concat(v, ": prev_document_hash doesn't match v").concat(v - 1));
                    process.exit(1);
                }
                // Verify signatures against the PREVIOUS version's governance roles
                verifyRoleSignatures(vDoc, trustedRoles, "v".concat(v));
                console.log("    v".concat(v, ": role signatures verified against v").concat(v - 1, " governance roles"));
            }
            // This version's governance roles become the trusted set for the next version
            trustedRoles = vDoc.governance.roles;
        }
        console.log("  Chain of trust verified: v1 -> v".concat(currentVersion));
    }
    // ── Summary ────────────────────────────────────────────────────────────
    var sigsByRole = new Map();
    for (var _m = 0, _o = doc.signatures; _m < _o.length; _m++) {
        var sig = _o[_m];
        sigsByRole.set(sig.role, ((_c = sigsByRole.get(sig.role)) !== null && _c !== void 0 ? _c : 0) + 1);
    }
    var sigSummary = __spreadArray([], sigsByRole.entries(), true).map(function (_a) {
        var role = _a[0], count = _a[1];
        return "".concat(role, ":").concat(count);
    })
        .join(', ');
    console.log("\nDocument is valid \u2014 ".concat(doc.signatures.length, " role signatures verified (").concat(sigSummary, ")"));
    console.log("  Governance roles: ".concat(doc.governance.roles.map(function (r) { return "".concat(r.role, "(").concat(r.quorum, "/").concat(r.addresses.length, ")"); }).join(', ')));
    // ── Version file consistency checks ─────────────────────────────────────
    if ((0, fs_1.existsSync)(versionsDir)) {
        var versionFile = (0, path_1.resolve)(versionsDir, "".concat(currentVersion, ".json"));
        if ((0, fs_1.existsSync)(versionFile)) {
            var versionDoc = JSON.parse((0, fs_1.readFileSync)(versionFile, 'utf-8'));
            if (versionDoc.registry_metadata.document_hash !== meta.document_hash) {
                console.error("  Version file ".concat(currentVersion, ".json does not match registry.json"));
                process.exit(1);
            }
            console.log("  Version file ".concat(currentVersion, ".json matches registry.json"));
        }
        else {
            console.warn("  Version file ".concat(currentVersion, ".json not found"));
        }
        // List all available versions
        var files = (0, fs_1.readdirSync)(versionsDir)
            .filter(function (f) { return /^\d+\.json$/.test(f); })
            .map(function (f) { return parseInt(f, 10); })
            .sort(function (a, b) { return a - b; });
        console.log("  Available versions: [".concat(files.join(', '), "]"));
    }
}
main();
