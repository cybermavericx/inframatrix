import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  /** optional — auto-generated if omitted */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;

  /** module keys the user can access (the tabs), e.g. ['infra','jobbag'] */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moduleKeys?: string[];

  /** group keys granted, e.g. ['infra.servers.admin','jobbag.jobs.editor'] */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupKeys?: string[];

  /** if true, they must enable MFA within 15 days (see UsersService.create) */
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;
}
