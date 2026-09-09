import type { SiteProvider } from "../../../contract";

export default function makeBarComProvider(): SiteProvider {
  return { id: "bar-com", domains: ["bar.com"] };
}
