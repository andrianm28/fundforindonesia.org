// User entity types matching Prisma models

export interface User {
  id: string;
  email: string;
  name: string;
  password?: string | null;
  avatar?: string | null;
  phone?: string | null;
  donationBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id: string;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
}

// Relation types

export interface UserWithRelations extends User {
  campaigns: import("./campaign").Campaign[];
  donations: import("./donation").Donation[];
  prayers: import("./donation").Prayer[];
  notifications: import("./notification").Notification[];
  autoDonations: import("./notification").AutoDonation[];
  accounts: Account[];
}

export interface UserWithCampaigns extends User {
  campaigns: import("./campaign").Campaign[];
}

export interface UserWithDonations extends User {
  donations: import("./donation").Donation[];
}

// Input/create types

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  phone?: string;
}

export interface UpdateUserInput {
  name?: string;
  avatar?: string;
  phone?: string;
}

// Session/auth types

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
}
