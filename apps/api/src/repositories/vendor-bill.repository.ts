import { Repository } from "./repository";

/** Data access for `vendor_bills`. */
export class VendorBillRepository extends Repository {
  /** Every bill raised by one vendor. */
  forVendor(vendorId: string) {
    return this.find((b) => b.vendorId === vendorId);
  }
}
