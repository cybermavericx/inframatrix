import { IsString, MinLength } from 'class-validator';

export class MfaCodeDto {
  @IsString()
  @MinLength(6)
  code: string;
}
