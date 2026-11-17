export interface Claim {
  name: string;
  description: string;
  key?: string;
  isDisable?: boolean;
  parentSelection?: string;
}

export interface ECommercePlatform {
  name: string;
  typeOfClaims: Claim[];
}
