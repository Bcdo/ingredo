// Wire DTOs — camelCase as serialized by the ASP.NET backend.
export type UserResponseDto = {
  id: string;
  email: string;
  displayName: string;
  householdId: string;
  householdName: string;
};

export type AuthResponseDto = {
  accessToken: string;
  refreshToken: string;
  user: UserResponseDto;
};

export type MemberDto = {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
};

export type HouseholdDto = {
  id: string;
  name: string;
  joinCode: string;
  members: MemberDto[];
};
