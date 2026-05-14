"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic helpers — Ethereum ECDSA signatures + SHA256 hashing
// ─────────────────────────────────────────────────────────────────────────────
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
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
exports.verifyAllRoleQuorums = exports.verifyRoleQuorum = exports.verifyRotationProof = exports.deriveNodeId = exports.verifySingleSig = exports.recoverSigner = exports.signDocument = exports.getEIP712Payload = exports.buildTypedDataValue = exports.EIP712_TYPES = exports.EIP712_DOMAIN = exports.computeMerkleRoot = exports.computeDocumentHash = exports.hashString = exports.hashObject = void 0;
var ethers_1 = require("ethers");
var crypto_1 = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-var-requires
var ed25519 = require('@noble/curves/ed25519.js').ed25519;
// ── Hashing ───────────────────────────────────────────────────────────────────
function hashObject(obj) {
    var canonical = JSON.stringify(obj, function (_k, v) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.fromEntries(Object.entries(v).sort(function (_a, _b) {
                var a = _a[0];
                var b = _b[0];
                return a.localeCompare(b);
            }));
        }
        return v;
    });
    return (0, crypto_1.createHash)('sha256').update(canonical).digest('hex');
}
exports.hashObject = hashObject;
function hashString(s) {
    return (0, crypto_1.createHash)('sha256').update(s).digest('hex');
}
exports.hashString = hashString;
function computeDocumentHash(doc) {
    // Set document_hash to empty string before hashing
    var clone = JSON.parse(JSON.stringify(doc));
    clone.registry_metadata.document_hash = '';
    return hashObject(clone);
}
exports.computeDocumentHash = computeDocumentHash;
// ── Merkle tree ───────────────────────────────────────────────────────────────
function computeMerkleRoot(nodes) {
    if (nodes.length === 0)
        return hashString('empty');
    var leaves = __spreadArray([], nodes, true).sort(function (a, b) { return a.node_id.localeCompare(b.node_id); })
        .map(function (n) { return hashString('leaf:' + hashObject(n)); });
    return buildMerkleTree(leaves)[0];
}
exports.computeMerkleRoot = computeMerkleRoot;
function buildMerkleTree(leaves) {
    if (leaves.length === 1)
        return leaves;
    var next = [];
    for (var i = 0; i < leaves.length; i += 2) {
        var right = i + 1 < leaves.length ? leaves[i + 1] : leaves[i];
        next.push(hashString('node:' + leaves[i] + ':' + right));
    }
    return buildMerkleTree(next);
}
// ── EIP-712 Typed Data Signing ───────────────────────────────────────────────
exports.EIP712_DOMAIN = {
    name: 'MPC Node Registry',
    version: '2',
};
exports.EIP712_TYPES = {
    Endpoints: [
        { name: 'primary', type: 'string' },
        { name: 'mirrors', type: 'string[]' },
    ],
    RegistryMetadata: [
        { name: 'registry_id', type: 'string' },
        { name: 'version', type: 'uint256' },
        { name: 'issued_at', type: 'uint256' },
        { name: 'expires_at', type: 'uint256' },
        { name: 'updated_at', type: 'string' },
        { name: 'document_hash', type: 'string' },
        { name: 'merkle_root', type: 'string' },
        { name: 'prev_document_hash', type: 'string' },
        { name: 'endpoints', type: 'Endpoints' },
    ],
    GovernanceRole: [
        { name: 'role', type: 'string' },
        { name: 'display_name', type: 'string' },
        { name: 'addresses', type: 'address[]' },
        { name: 'quorum', type: 'uint256' },
        { name: 'features_json', type: 'string' },
    ],
    CeremonyConfig: [
        { name: 'allowed_protocols', type: 'string[]' },
        { name: 'allowed_curves', type: 'string[]' },
    ],
    TrustedInfrastructure: [
        { name: 'market_oracle_pubkey', type: 'string[]' },
        { name: 'trusted_binary_hashes', type: 'string[]' },
    ],
    NodeRecord: [
        { name: 'node_id', type: 'string' },
        { name: 'ik_pub', type: 'string' },
        { name: 'ek_pub', type: 'string' },
        { name: 'role', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'enrolled_at', type: 'uint256' },
        { name: 'updated_at', type: 'uint256' },
        { name: 'revoked_at', type: 'uint256' },
    ],
    RegistryDocument: [
        { name: 'registry_metadata', type: 'RegistryMetadata' },
        { name: 'governance', type: 'GovernanceRole[]' },
        { name: 'ceremony_config', type: 'CeremonyConfig' },
        { name: 'trusted_infrastructure', type: 'TrustedInfrastructure' },
        { name: 'nodes', type: 'NodeRecord[]' },
    ],
};
function buildTypedDataValue(doc) {
    var _a, _b, _c, _d;
    var meta = doc.registry_metadata;
    return {
        registry_metadata: {
            registry_id: meta.registry_id,
            version: meta.version,
            issued_at: meta.issued_at,
            expires_at: meta.expires_at,
            updated_at: (_a = meta.updated_at) !== null && _a !== void 0 ? _a : '',
            document_hash: meta.document_hash,
            merkle_root: meta.merkle_root,
            prev_document_hash: (_b = meta.prev_document_hash) !== null && _b !== void 0 ? _b : '',
            endpoints: meta.endpoints
                ? { primary: meta.endpoints.primary, mirrors: meta.endpoints.mirrors }
                : { primary: '', mirrors: [] },
        },
        governance: doc.governance.roles.map(function (r) {
            var _a;
            return ({
                role: r.role,
                display_name: r.display_name,
                addresses: r.addresses,
                quorum: r.quorum,
                features_json: JSON.stringify((_a = r.features) !== null && _a !== void 0 ? _a : {}),
            });
        }),
        ceremony_config: {
            allowed_protocols: doc.ceremony_config.allowed_protocols,
            allowed_curves: doc.ceremony_config.allowed_curves,
        },
        trusted_infrastructure: {
            market_oracle_pubkey: (_c = doc.trusted_infrastructure.market_oracle_pubkey) !== null && _c !== void 0 ? _c : [],
            trusted_binary_hashes: (_d = doc.trusted_infrastructure.trusted_binary_hashes) !== null && _d !== void 0 ? _d : [],
        },
        nodes: doc.nodes.map(function (n) {
            var _a, _b;
            return ({
                node_id: n.node_id,
                ik_pub: n.ik_pub,
                ek_pub: n.ek_pub,
                role: n.role,
                status: n.status,
                enrolled_at: n.enrolled_at,
                updated_at: (_a = n.updated_at) !== null && _a !== void 0 ? _a : 0,
                revoked_at: (_b = n.revoked_at) !== null && _b !== void 0 ? _b : 0,
            });
        }),
    };
}
exports.buildTypedDataValue = buildTypedDataValue;
function getEIP712Payload(doc) {
    return {
        domain: exports.EIP712_DOMAIN,
        types: exports.EIP712_TYPES,
        primaryType: 'RegistryDocument',
        message: buildTypedDataValue(doc),
    };
}
exports.getEIP712Payload = getEIP712Payload;
function signDocument(doc, privateKey) {
    return __awaiter(this, void 0, void 0, function () {
        var wallet, value;
        return __generator(this, function (_a) {
            wallet = new ethers_1.ethers.Wallet(privateKey);
            value = buildTypedDataValue(doc);
            return [2 /*return*/, wallet.signTypedData(exports.EIP712_DOMAIN, exports.EIP712_TYPES, value)];
        });
    });
}
exports.signDocument = signDocument;
function recoverSigner(doc, signature) {
    var value = buildTypedDataValue(doc);
    return ethers_1.ethers.verifyTypedData(exports.EIP712_DOMAIN, exports.EIP712_TYPES, value, signature);
}
exports.recoverSigner = recoverSigner;
function verifySingleSig(doc, signature, expectedAddress) {
    try {
        var recovered = recoverSigner(doc, signature);
        return recovered.toLowerCase() === expectedAddress.toLowerCase();
    }
    catch (_a) {
        return false;
    }
}
exports.verifySingleSig = verifySingleSig;
function deriveNodeId(ikPub, role, enrolledAt) {
    return hashString('nodeId:' + ikPub + ':' + role + ':' + enrolledAt.toString());
}
exports.deriveNodeId = deriveNodeId;
// ── Ed25519 rotation proof verification ───────────────────────────────────────
function verifyRotationProof(prevIkPub, newIkPub, timestamp, proof) {
    try {
        var message = "rotate:".concat(prevIkPub, ":").concat(newIkPub, ":").concat(timestamp);
        var msgBytes = new TextEncoder().encode(message);
        var sigBytes = Buffer.from(proof, 'hex');
        var pubBytes = Buffer.from(prevIkPub, 'hex');
        return ed25519.verify(sigBytes, msgBytes, pubBytes);
    }
    catch (_a) {
        return false;
    }
}
exports.verifyRotationProof = verifyRotationProof;
// ── Role-based signature verification ─────────────────────────────────────────
/**
 * Verify that a governance role's quorum is met by the given signatures.
 * Signatures are verified against the role's address list.
 */
function verifyRoleQuorum(doc, signatures, role) {
    var roleSigs = signatures.filter(function (s) { return s.role.toUpperCase() === role.role.toUpperCase(); });
    if (roleSigs.length < role.quorum) {
        return { valid: false, reason: "".concat(role.role, ": need >= ").concat(role.quorum, " signatures, got ").concat(roleSigs.length) };
    }
    var addrSet = new Set(role.addresses.map(function (a) { return a.toLowerCase(); }));
    var seen = new Set();
    var validCount = 0;
    for (var _i = 0, roleSigs_1 = roleSigs; _i < roleSigs_1.length; _i++) {
        var sig = roleSigs_1[_i];
        var addr = sig.signer.toLowerCase();
        if (seen.has(addr)) {
            return { valid: false, reason: "".concat(role.role, ": duplicate signer ").concat(sig.signer) };
        }
        seen.add(addr);
        if (!addrSet.has(addr)) {
            return { valid: false, reason: "".concat(role.role, ": unknown signer ").concat(sig.signer) };
        }
        if (!/^0x[0-9a-f]{130}$/i.test(sig.signature)) {
            return { valid: false, reason: "".concat(role.role, ": malformed signature from ").concat(sig.signer) };
        }
        var ok = verifySingleSig(doc, sig.signature, sig.signer);
        if (!ok) {
            return { valid: false, reason: "".concat(role.role, ": invalid signature from ").concat(sig.signer) };
        }
        validCount++;
    }
    if (validCount < role.quorum) {
        return { valid: false, reason: "".concat(role.role, ": only ").concat(validCount, " valid, need ").concat(role.quorum) };
    }
    return { valid: true };
}
exports.verifyRoleQuorum = verifyRoleQuorum;
/**
 * Verify all roles in a governance section meet their quorum.
 */
function verifyAllRoleQuorums(doc, signatures, roles) {
    for (var _i = 0, roles_1 = roles; _i < roles_1.length; _i++) {
        var role = roles_1[_i];
        var result = verifyRoleQuorum(doc, signatures, role);
        if (!result.valid)
            return result;
    }
    return { valid: true };
}
exports.verifyAllRoleQuorums = verifyAllRoleQuorums;
