import { IsString, MinLength } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @MinLength(1)
  mfaToken: string;

  @IsString()
  @MinLength(6)
  code: string;
}
