"use client";

import { Fragment, type ReactNode } from "react";
import { isLabelParagraph, plainTextToBlocks, type ContentBlock } from "@/lib/textToHtml";
import { parseMarkedRuns, wrapIntoRunLines, type Run } from "@/lib/centeredLineWrap";
import { splitIntoSections, findSectionCaption, removeFirstMatchingParagraph } from "@/lib/sectionAssignment";
import { planImages } from "@/lib/imagePlan";

export type PreviewImage = { id: string; slotIndex: number; sourceRef: string | null; url: string };

// 발행 결과 근사 미리보기. 줄바꿈은 Playwright 타이핑과 같은 wrapIntoRunLines를 써서
// 미리보기가 실제 발행 결과와 어긋나지 않게 한다.

function RunSpan({ run }: { run: Run }) {
  let node: ReactNode = run.text;
  if (run.marks.includes("highlight")) node = <mark style={{ background: "#fff593", color: "inherit" }}>{node}</mark>;
  if (run.marks.includes("underline")) node = <u>{node}</u>;
  if (run.marks.includes("bold")) node = <strong>{node}</strong>;
  return <>{node}</>;
}

function Paragraph({ text }: { text: string }) {
  // 정보 라벨("**주차**")은 바로 아래 설명과 붙여 보여준다(발행 때도 빈 줄 없이 이어 침)
  return (
    <p className={`text-center leading-7 ${isLabelParagraph(text) ? "mt-6 -mb-3" : "my-4"}`}>
      {wrapIntoRunLines(text).map((line, i) => (
        <span key={i} className="block">
          {line.map((r, j) => <RunSpan key={j} run={r} />)}
        </span>
      ))}
    </p>
  );
}

function Box({ lines }: { lines: string[] }) {
  return (
    <div className="mx-auto my-5 max-w-md rounded border-2 border-dashed border-line px-5 py-4 text-center leading-7">
      {lines.map((l, i) => (
        <span key={i} className="block">{parseMarkedRuns(l).map((r, j) => <RunSpan key={j} run={r} />)}</span>
      ))}
    </div>
  );
}

function Img({ img }: { img: PreviewImage }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={img.url} alt="" className="mx-auto my-4 max-h-[420px] w-auto max-w-full rounded" />
  );
}

function Block({ b }: { b: ContentBlock }) {
  switch (b.type) {
    case "paragraph":
      return <Paragraph text={b.text} />;
    case "heading":
      return <h3 className="mx-auto mt-10 mb-4 max-w-md border-b-2 border-fg pb-2 text-center text-lg font-bold">{b.text}</h3>;
    case "toc":
      return <Box lines={b.items} />;
    case "photoQuote":
      return <Box lines={b.text.split("\n")} />;
    case "table":
      return (
        <table className="mx-auto my-5 w-full max-w-lg border-collapse text-center text-sm">
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri} style={{ background: ri === 0 ? "#fff593" : "#f7f7f7", color: "#1d2329" }}>
                {r.map((c, ci) => (
                  <td key={ci} className={`border border-line px-2 py-2 ${ri === 0 ? "font-bold" : ""}`}>{c.replace(/\*\*|__|==/g, "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export default function DraftPreview({ title, bodyText, images, tags }: { title: string; bodyText: string; images: PreviewImage[]; tags: string[] }) {
  const blocks = plainTextToBlocks(bodyText);
  const sections = splitIntoSections(blocks);
  const plan = planImages(images, sections.length - 1);

  return (
    <article className="mx-auto max-w-2xl rounded-xl border border-line bg-surface px-5 py-8">
      <h1 className="mb-6 border-b border-line pb-4 text-2xl font-bold">{title || "(제목 없음)"}</h1>
      {plan.lead && <Img img={plan.lead} />}
      {sections[0].blocks.map((b, i) => <Block key={`i${i}`} b={b} />)}
      {sections.slice(1).map((s, si) => {
        const main = plan.sectionMain[si];
        const caption = main ? findSectionCaption(s) : null;
        const body = caption ? removeFirstMatchingParagraph(s.blocks, caption) : s.blocks;
        const extras = [...plan.sectionExtras[si]];
        let since = 0;
        return (
          <Fragment key={`s${si}`}>
            <Block b={{ type: "heading", text: s.heading ?? "" }} />
            {main && <Img img={main} />}
            {caption && <Paragraph text={caption} />}
            {body.map((b, bi) => {
              if (b.type === "paragraph") since++;
              // 실제 발행은 2~3문장마다 랜덤 — 미리보기는 2문장마다로 근사
              const extra = extras.length && since >= 2 ? extras.shift() : null;
              if (extra) since = 0;
              return (
                <Fragment key={bi}>
                  <Block b={b} />
                  {extra && <Img img={extra} />}
                </Fragment>
              );
            })}
            {extras.map((x) => <Img key={x.id} img={x} />)}
          </Fragment>
        );
      })}
      {tags.length > 0 && (
        <p className="mt-10 flex flex-wrap gap-1.5 border-t border-line pt-4 text-sm text-muted">
          {tags.map((t) => <span key={t}>#{t}</span>)}
        </p>
      )}
    </article>
  );
}
