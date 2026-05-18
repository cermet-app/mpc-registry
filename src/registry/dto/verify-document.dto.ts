import { IsString, IsNumber, IsArray, ValidateNested, IsIn, IsOptional, Matches, ArrayNotEmpty, Min } from 'class-validator'
import { Type } from 'class-transformer'

class IkRotationEntryDto {
  @IsString()
  prev_ik_pub: string

  @IsString()
  new_ik_pub: string

  @IsNumber()
  rotated_at: number

  @IsString()
  reason: string

  @IsString()
  proof: string
}

class NodeRecordDto {
  @IsString()
  node_id: string

  @IsString()
  ik_pub: string

  @IsIn(['USER_COSIGNER', 'PROVIDER_COSIGNER', 'RECOVERY_GUARDIAN'])
  role: string

  @IsIn(['ACTIVE', 'REVOKED', 'MAINTENANCE'])
  status: string

  @IsNumber()
  enrolled_at: number

  @IsOptional()
  @IsNumber()
  updated_at?: number

  @IsOptional()
  @IsNumber()
  revoked_at?: number

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IkRotationEntryDto)
  ik_rotations?: IkRotationEntryDto[]
}

class RoleSignatureDto {
  @IsString()
  role: string

  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'signer must be a valid Ethereum address' })
  signer: string

  @IsString()
  signature: string
}

class EndpointsDto {
  @IsString()
  primary: string

  @IsArray()
  @IsString({ each: true })
  mirrors: string[]
}

class CeremonyConfigDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  allowed_protocols: string[]

  @IsArray() @ArrayNotEmpty() @IsString({ each: true })
  allowed_curves: string[]
}

class GovernanceRoleDto {
  @IsIn(['SYSTEM_ADMIN', 'POLICY_COMPLIANCE', 'TREASURY_OPS', 'AUDIT_OBSERVER'])
  role: string

  @IsString()
  display_name: string

  @IsArray()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { each: true })
  addresses: string[]

  @IsNumber() @Min(1)
  quorum: number

  @IsOptional()
  features?: Record<string, any>
}

class GovernanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GovernanceRoleDto)
  roles: GovernanceRoleDto[]
}

class RegistryMetadataDto {
  @IsString()
  registry_id: string

  @IsNumber()
  version: number

  @IsNumber()
  issued_at: number

  @IsNumber()
  expires_at: number

  @IsString()
  updated_at: string

  @IsString()
  document_hash: string

  @IsString()
  merkle_root: string

  @IsOptional()
  prev_document_hash: string | null

  @IsOptional()
  @ValidateNested()
  @Type(() => EndpointsDto)
  endpoints: EndpointsDto | null
}

class TrustedInfrastructureDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(/^0x[0-9a-fA-F]{40}$/, { each: true, message: 'market_oracle_pubkey entries must be valid Ethereum addresses' })
  market_oracle_pubkey: string[]

  @IsArray()
  @IsString({ each: true })
  trusted_binary_hashes: string[]
}

export class VerifyDocumentDto {
  @ValidateNested()
  @Type(() => RegistryMetadataDto)
  registry_metadata: RegistryMetadataDto

  @ValidateNested()
  @Type(() => GovernanceDto)
  governance: GovernanceDto

  @ValidateNested()
  @Type(() => CeremonyConfigDto)
  ceremony_config: CeremonyConfigDto

  @ValidateNested()
  @Type(() => TrustedInfrastructureDto)
  trusted_infrastructure: TrustedInfrastructureDto

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeRecordDto)
  nodes: NodeRecordDto[]

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleSignatureDto)
  signatures: RoleSignatureDto[]
}
