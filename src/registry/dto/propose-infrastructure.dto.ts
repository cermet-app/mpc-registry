import { IsOptional, IsString, IsArray, Matches } from 'class-validator'

export class ProposeInfrastructureDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[0-9a-fA-F]{64}$/, { each: true, message: 'market_oracle_pubkey entries must be 32-byte hex public keys (64 hex chars, no 0x prefix)' })
  market_oracle_pubkey?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trusted_binary_hashes?: string[]
}
