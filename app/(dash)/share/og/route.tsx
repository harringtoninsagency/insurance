import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { appBaseUrl } from "@/lib/base-url";

export const runtime = "nodejs";

const markBytes = readFileSync(join(process.cwd(), "assets", "branding", "brightway-mark-bright-yellow.png"));
const markDataUrl = `data:image/png;base64,${markBytes.toString("base64")}`;

export async function GET() {
  const signupUrl = `${appBaseUrl()}/partner/signup`;
  const qrDataUrl = await QRCode.toDataURL(signupUrl, {
    type: "image/png",
    color: { dark: "#003049", light: "#FFFFFF" },
    margin: 1,
    width: 560,
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#003049",
          padding: "64px 72px",
        }}
      >
        <img src={markDataUrl} width={88} height={88} alt="" />
        <div style={{ marginTop: 14, fontSize: 22, color: "#8FA3BF" }}>Brightway Insurance | The Harrington Agency</div>
        <div style={{ marginTop: 10, width: 88, height: 5, backgroundColor: "#F0FF00" }} />

        <div
          style={{
            marginTop: 44,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: 52,
            fontWeight: 700,
            color: "#FFFFFF",
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          <div>Get Instant Home</div>
          <div>Insurance Quotes</div>
        </div>
        <div style={{ marginTop: 18, fontSize: 26, color: "#C3D1E3", textAlign: "center", maxWidth: 760 }}>
          Scan to join our partner program — free, automated quotes for your clients in minutes.
        </div>

        <div
          style={{
            marginTop: 40,
            backgroundColor: "#FFFFFF",
            borderRadius: 20,
            padding: 24,
            display: "flex",
          }}
        >
          <img src={qrDataUrl} width={400} height={400} alt="" />
        </div>

        <div style={{ marginTop: 32, fontSize: 24, fontWeight: 600, color: "#F0FF00" }}>{signupUrl.replace(/^https?:\/\//, "")}</div>
      </div>
    ),
    { width: 1080, height: 1080 },
  );
}
