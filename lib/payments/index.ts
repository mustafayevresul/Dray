import { Currency } from "@prisma/client";
import { PaymentProvider } from "./types";
import { stripeProvider } from "./stripeProvider";
import { localGatewayProvider } from "./localGatewayProvider";

export function resolvePaymentProvider(currency: Currency): PaymentProvider {
  switch (currency) {
    case "USD":
      return stripeProvider;
    case "AZN":
      return localGatewayProvider;
  }
}

export type { PaymentProvider } from "./types";
export { createDriverConnectOnboardingLink } from "./stripeProvider";
