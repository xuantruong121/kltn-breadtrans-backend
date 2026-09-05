export declare class RegisterDto {
    email: string;
    password: string;
    fullName: string;
}
export declare class LoginDto {
    email: string;
    password: string;
    deviceId?: string;
}
export declare class RefreshTokenDto {
    deviceId: string;
    refreshToken: string;
}
export declare class GenerateOtpDto {
    email: string;
}
export declare class VerifyOtpDto {
    email: string;
    otp: string;
}
export declare class VerifyRegistrationDto {
    email: string;
    otp: string;
}
export declare class ChangePasswordDto {
    currentPassword: string;
    newPassword: string;
}
export declare class ActivateTeacherDto {
    token: string;
    newPassword: string;
}
