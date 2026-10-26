import RunPipelinePanel from "@/components/RunPipelinePanel";
import RecentDrafts from "@/components/RecentDrafts";
import MobileUploadQr from "@/components/MobileUploadQr";

export default function Home() {
  return (
    <div className="space-y-6">
      <RunPipelinePanel />
      <RecentDrafts />
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">폰에서 열기 (사진 업로드용 QR)</summary>
        <div className="mt-3"><MobileUploadQr /></div>
      </details>
    </div>
  );
}
