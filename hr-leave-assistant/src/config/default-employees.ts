/** One synthetic employee used to seed an `EmployeeLeave` actor for the demo. */
export interface DemoEmployee {
  employeeNumber: string;
  firstName: string;
  entitlementDays: number;
  openingUsedDays: number;
  pin: string;
  secretQuestion: string | null;
  secretAnswer: string | null;
}

// Entirely synthetic demo data. Never put production credentials in this file.
export const DEFAULT_EMPLOYEES: readonly DemoEmployee[] = [
  {
    employeeNumber: "1001",
    firstName: "Alex",
    entitlementDays: 14,
    openingUsedDays: 6,
    pin: "1111",
    secretQuestion: "What is your favourite colour?",
    secretAnswer: "Blue",
  },
  {
    employeeNumber: "1002",
    firstName: "Priya",
    entitlementDays: 14,
    openingUsedDays: 12,
    pin: "2222",
    secretQuestion: "What city were you born in?",
    secretAnswer: "Mumbai",
  },
  {
    employeeNumber: "1003",
    firstName: "Sam",
    entitlementDays: 14,
    openingUsedDays: 9,
    pin: "3333",
    secretQuestion: "What was the name of your first pet?",
    secretAnswer: "Buddy",
  },
  {
    employeeNumber: "1004",
    firstName: "Jordan",
    entitlementDays: 14,
    openingUsedDays: 0,
    pin: "4444",
    secretQuestion: "What is your mother's maiden name?",
    secretAnswer: "Johnson",
  },
];
