import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @IsIn(['Y', 'N'])
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moduleKeys?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupKeys?: string[];

  /** flips the enforcement policy — see UsersService.update for the "only start the clock once" rule */
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;
}
