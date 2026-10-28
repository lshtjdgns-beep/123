"use client";

import type { ReactNode } from "react";
import type { DraftReport, VerificationCheck } from "@/lib/reportTypes";

// drafts.report_json을 그대로 펼쳐 보여준다 — "왜 이 글이 이렇게 나왔는지" 바로 알 수 있게.

const ENDING_LABEL: Record<string, string> = {
  formal: "합니다체", polite: "해요체", plain: "평서(~다)", laughOrCry: "ㅎㅎ/ㅋㅋ/ㅠㅠ", tilde: "물결(~)", exclamation: "느낌표", question: "물음표",
};

function Section({ title, badge, children, open }: { title: string; badge?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="rounded-lg border border-line bg-surface" open={open}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
        <span>{title}</span>
        {badge}
      </summary>
      <div className="border-t border-line px-3 py-3 text-sm">{children}</div>
    </details>
  );
}

const Badge = ({ ok, text }: { ok: boolean | null; text: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs ${ok === null ? "bg-subtle text-muted" : ok ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"}`}>{text}</span>
);

export function CheckList({ checks }: { checks: VerificationCheck[] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c) => (
        <li key={c.label} className="flex gap-2">
          <span className={c.pass ? "text-brand" : "text-danger"}>{c.pass ? "✔" : "✘"}</span>
          <span><b>{c.label}</b> <span className="text-muted">— {c.detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

const List = ({ items }: { items: string[] }) => (items.length ? <ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-muted">없음</span>);

export default function GenerationReport({ report }: { report: DraftReport | null }) {
  if (!report) return <p className="text-sm text-muted">생성 리포트가 없습니다.</p>;
  const { rank, style, verification, targets } = report;
  const pb = rank?.playbook;

  return (
    <div className="space-y-2">
      <Section title="최종 체크리스트" badge={<Badge ok={verification.allPassed} text={verification.allPassed ? "모두 충족" : "미충족 있음"} />} open>
        <CheckList checks={verification.finalChecks} />
        {verification.review && (
          <div className="mt-3 space-y-1 border-t border-line pt-2">
            {verification.review.structure && <p><b>상위노출 방식 반영:</b> {verification.review.structure.pass ? "통과" : "미흡"} — {verification.review.structure.reason}</p>}
            {verification.review.tone && <p><b>말투 반영:</b> {verification.review.tone.pass ? "통과" : "미흡"} — {verification.review.tone.reason}</p>}
          </div>
        )}
      </Section>

      <Section title={`검증 라운드 (${verification.rounds.length}회)`}>
        <ol className="space-y-2">
          {verification.rounds.map((r) => (
            <li key={r.round}>
              <b>{r.round}라운드</b> {r.passed ? <span className="text-brand">통과</span> : <span className="text-danger">미충족 {r.issues.length}개 → 재작성</span>}
              {!r.passed && <List items={r.issues} />}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="목표치">
        <p>본문 {targets.minBodyLength}자 이상 · 소제목 {targets.minSubheadingCount}개 이상 · 표 {targets.minTableCount}개 이상 · 제목 {targets.maxTitleLength}자 이내</p>
      </Section>

      <Section title={`상위노출 분석 — "${report.rankKeyword}"`} badge={<Badge ok={rank ? Boolean(pb) : false} text={rank ? (pb ? "공략법 있음" : "실측만") : "실패"} />}>
        {!rank && <p className="text-danger">{report.rankError ?? "분석 결과 없음"}</p>}
        {rank && (
          <div className="space-y-3">
            <p className="text-muted">평균 {rank.avgCharCount}자 · 이미지 {rank.avgImageCount}장 · 표 {rank.avgTableCount}개</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="text-muted"><th className="py-1">순위</th><th>제목</th><th>글자</th><th>이미지</th><th>표</th></tr></thead>
                <tbody>
                  {rank.posts.map((p) => (
                    <tr key={p.url} className="border-t border-line align-top">
                      <td className="py-1">{p.rank}</td>
                      <td><a href={p.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{p.title}</a>
                        {p.headings.length > 0 && <div className="text-muted">{p.headings.slice(0, 6).join(" / ")}</div>}</td>
                      <td>{p.charCount}</td><td>{p.imageCount}</td><td>{p.tableCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pb ? (
              <div className="space-y-1">
                <p><b>제목 방식:</b> {pb.titlePatterns.join(" / ")} ({pb.titleLength.min}~{pb.titleLength.max}자)</p>
                <p><b>키워드 배치:</b> {pb.keywordPlacement.join(" / ")}</p>
                <p><b>글 뼈대:</b> {pb.sectionFlow.join(" → ")}</p>
                <p><b>도입:</b> {pb.introHook}</p>
                <p><b>마무리:</b> {pb.closing}</p>
                <p><b>권장 분량:</b> {pb.recommended.charCount}자 · 이미지 {pb.recommended.imageCount} · 소제목 {pb.recommended.subheadingCount} · 표 {pb.recommended.tableCount}</p>
                <div><b>정보 기법:</b> <List items={pb.techniques} /></div>
                <div><b>핵심 주제:</b> <List items={pb.mustCoverTopics} /></div>
                <p><b>분위기:</b> {pb.toneNotes}</p>
              </div>
            ) : (
              <p className="text-warn">공략법 구조화 실패: {rank.playbookError}</p>
            )}
          </div>
        )}
      </Section>

      <Section title="말투 분석" badge={<Badge ok={style ? style.source !== "none" : false} text={style?.source === "fresh" ? "새로 분석" : style?.source === "saved" ? "저장본 사용" : "기본 톤"} />}>
        {style?.error && <p className="mb-2 text-warn">{style.error}</p>}
        {style && style.postsUsed > 0 && <p className="mb-2 text-muted">참고한 글: {style.titles.join(" / ")}</p>}
        {style?.endingStats && (
          <p className="mb-2">{Object.entries(style.endingStats).map(([k, v]) => `${ENDING_LABEL[k] ?? k} ${Math.round(v * 100)}%`).join(" · ")}</p>
        )}
        {style?.toneSummary && <pre className="whitespace-pre-wrap font-sans">{style.toneSummary}</pre>}
      </Section>

      {report.photos && (
        <Section title="사진 분석" badge={<Badge ok={!report.photos.error} text={`${report.photos.analyzed}/${report.photos.count}장`} />}>
          {report.photos.error ? <p className="text-warn">{report.photos.error}</p> : <p>모든 사진을 분석했습니다.</p>}
        </Section>
      )}

      <Section title="이미지 / 임시저장" badge={<Badge ok={report.autoSave ? (report.autoSave.attempted ? report.autoSave.success : null) : null} text={report.autoSave?.attempted ? (report.autoSave.success ? "임시저장 완료" : "임시저장 실패") : "임시저장 안 함"} />}>
        <p>이미지 {report.images?.count ?? 0}장{report.images?.error ? ` — ${report.images.error}` : ""}</p>
        {report.autoSave?.error && <p className="text-danger">{report.autoSave.error}</p>}
        {report.autoSave?.warnings?.map((w) => <p key={w} className="text-warn">{w}</p>)}
      </Section>
    </div>
  );
}
