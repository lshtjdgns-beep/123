import DraftEditor from "@/components/DraftEditor";

export default async function DraftPage(props: PageProps<"/draft/[draftId]">) {
  const { draftId } = await props.params;
  return <DraftEditor draftId={draftId} />;
}
