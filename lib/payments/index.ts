import { Currency } from "@prisma/client";
import { PaymentProvider } from "./types";
import { stripeProvider, createDriverConnectOnboardingLink } from "./stripeProvider";
import * as localGatewayModule from "./localGatewayProvider";

export { createDriverConnectOnboardingLink };
export { stripeProvider };

export function resolvePaymentProvider(currency: Currency): PaymentProvider {
  switch (currency) {
    case "USD":
      return stripeProvider;
    case "AZN":
      return (localGatewayModule as any).localGatewayProvider || localGatewayModule;
    default:
      throw new Error(`Unsupported currency: ${currency}`);
  }
}
