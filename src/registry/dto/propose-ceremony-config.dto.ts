import { IsArray, IsString, ArrayNotEmpty } from 'class-validator'

export class ProposeCeremonyConfigDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowed_protocols: string[]

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowed_curves: string[]
}
