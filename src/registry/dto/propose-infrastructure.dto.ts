import { IsOptional, IsString, IsArray, Matches } from 'class-validator'

export class ProposeInfrastructureDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^0x[0-9a-fA-F]{40}$/, { each: true, message: 'market_oracle_pubkey entries must be valid Ethereum addresses' })
  market_oracle_pubkey?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trusted_binary_hashes?: string[]
}
