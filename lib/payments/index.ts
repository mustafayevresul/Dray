import { Currency } from "@prisma/client";
import { PaymentProvider } from "./types";
import { stripeProvider } from "./stripeProvider";
import * as localGatewayModule from "./localGatewayProvider";

// localGatewayProvider faylından adı düzgün götürmək üçün:
const localGatewayProvider =
  (localGatewayModule as any).localGatewayProvider ||
  (localGatewayModule as any).default;

export function resolvePaymentProvider(currency: Currency): PaymentProvider {
  switch (currency) {
    case "USD":
      return stripeProvider;
    case "AZN":
      return localGatewayProvider;
    default:
      throw new Error(`Unsupported currency: ${currency}`);
  }
}
