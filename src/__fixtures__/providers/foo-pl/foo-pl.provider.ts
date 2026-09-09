import type { SiteProvider } from "../../../contract";

export default function makeFooPlProvider(): SiteProvider {
  return { id: "foo-pl", domains: ["foo.pl"], businessDomain: "vehicles" };
}
