import { describe, expect, it } from "vitest";
import {
  renderMarkdown,
  renderMarkdownInline,
} from "../public/markdown.js";

describe("Helix Markdown renderer", () => {
  it("Obsidian 접이식 callout과 그 안의 인용·제목·코드·표를 구조적으로 렌더한다", () => {
    const html = renderMarkdown(`
> [!quote]- 펼쳐서 대화 전체 다시 보기 (27개 메시지)
> **🤖 버디**
> ## 인덱스 설계 전략 — 첫 번째 레이어
>
> 처음 다루는 주제네.
>
> > 쇼핑몰 \`orders\` 테이블에 인덱스가 10개 있어.
>
> \`\`\`sql
> SELECT * FROM orders
> WHERE status = 'PAID';
> \`\`\`
>
> | index_name | COUNT_READ |
> | :--------- | ---------: |
> | PRIMARY | 15420 |
`);

    expect(html).toContain('<details class="md-callout md-callout-quote">');
    expect(html).toContain("펼쳐서 대화 전체 다시 보기 (27개 메시지)");
    expect(html).toContain('class="md-dialogue-turn md-dialogue-turn-buddy"');
    expect(html).toContain('<div class="md-dialogue" role="list" aria-label="나와 버디의 대화">');
    expect(html).toContain('<svg class="md-dialogue-symbol"');
    expect(html).toContain('<span class="md-dialogue-name">버디</span>');
    expect(html).not.toContain("🤖");
    expect(html).toContain("<h2>인덱스 설계 전략 — 첫 번째 레이어</h2>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("쇼핑몰 <code>orders</code>");
    expect(html).toContain('<pre class="codeblock" data-language="sql"><code>');
    expect(html.replace(/<\/?span[^>]*>/g, "")).toContain("SELECT * FROM orders");
    expect(html).toContain('<div class="md-table-wrap" role="region" aria-label="표">');
    expect(html).toContain('<th class="align-left">index_name</th>');
    expect(html).toContain('<th class="align-right">COUNT_READ</th>');
    expect(html).not.toContain("&gt; [!quote]");
  });

  it("일반 제목·목록·체크박스·구분선과 열린 callout을 지원한다", () => {
    const html = renderMarkdown(`
# 제목

1. 첫 항목
2. 둘째 항목
   - 하위 항목

- [x] 완료
- [ ] 예정

---

> [!tip]+ 기본으로 펼침
> 중요한 **팁**입니다.
`);

    expect(html).toContain("<h1>제목</h1>");
    expect(html).toContain("<ol><li>첫 항목</li><li>둘째 항목<ul><li>하위 항목</li></ul></li></ol>");
    expect(html).toContain('<input type="checkbox" disabled checked aria-hidden="true">');
    expect(html).toContain('<input type="checkbox" disabled aria-hidden="true">');
    expect(html).toContain("<hr>");
    expect(html).toContain('<details class="md-callout md-callout-tip" open>');
    expect(html).toContain("중요한 <strong>팁</strong>입니다.");
  });

  it("raw HTML과 위험한 링크를 실행 가능한 마크업으로 만들지 않는다", () => {
    const html = renderMarkdown(`
<img src=x onerror="alert(1)">

[위험](javascript:alert(1)) [안전](https://example.com/?a=1&b=2)

\`<svg onload=alert(1)>\`

\`\`\`html
<script>alert(1)</script>
\`\`\`
`);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">안전</a>');
    expect(html).toContain("<code>&lt;svg onload=alert(1)&gt;</code>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("목록 항목 아래의 실제 WAL fence를 인라인 텍스트가 아닌 코드 블록으로 유지한다", () => {
    const html = renderMarkdown(`
1. **배치 크기 조정**: 100~500건마다 COMMIT
   \`\`\`java
   @Transactional
   public void batchInsert(List<Order> orders) {
       em.flush();
   }
   \`\`\`
`);

    expect(html).toContain("<ol><li><strong>배치 크기 조정</strong>");
    expect(html).toContain('<pre class="codeblock" data-language="java"><code>');
    expect(html).toContain("@Transactional");
    expect(html.replace(/<\/?span[^>]*>/g, "")).toContain("public void batchInsert");
    expect(html).not.toContain("```java");
  });

  it("명시적으로 잘린 unclosed fence 뒤의 Markdown 블록만 안전하게 복구한다", () => {
    const html = renderMarkdown(`
\`\`\`
Change Buffer: Secondary Index 쓰기 최적화

... (truncated)

# 관련된 이전 학습 노트

- 첫 메시지는 짧게
`);

    expect(html).toContain("<pre");
    expect(html).toMatch(/\.\.\. \(truncated\)\s*<\/code><\/pre><h1>/);
    expect(html).toContain("<h1>관련된 이전 학습 노트</h1>");
    expect(html).toContain("<ul><li>첫 메시지는 짧게</li></ul>");
  });

  it("legacy details와 center wrapper의 정확한 안전 형태만 native 구조로 변환한다", () => {
    const html = renderMarkdown(`
<details>
<summary><strong>해설 보기</strong> · <em>중간</em></summary>

본문의 **강조**와 <img src=x onerror="alert(1)">는 안전해야 한다.
</details>

<div align="center">

**[홈으로](../README.md)**

</div>
`);

    expect(html).toContain('<details class="md-legacy-details">');
    expect(html).toContain("<summary><strong>해설 보기</strong> · <em>중간</em></summary>");
    expect(html).toContain("본문의 <strong>강조</strong>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain('<div class="md-align-center">');
    expect(html).toContain('<a href="../README.md">홈으로</a>');
  });

  it("속성이 붙은 details와 summary 안의 임의 HTML은 허용하지 않는다", () => {
    const html = renderMarkdown(`
<details onclick="alert(1)">
<summary><strong>제목</strong><img src=x onerror="alert(2)"></summary>
내용
</details>
`);

    expect(html).not.toContain("<details onclick");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;details onclick=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
  });

  it("section 경계로 닫힘 태그가 사라진 legacy summary도 태그 문자 없이 보존한다", () => {
    const html = renderMarkdown(`
<details>
<summary><strong>Redo Log</strong> · <em>중간</em></summary>
`);

    expect(html).toBe(
      '<p class="md-legacy-summary"><strong>Redo Log</strong> · <em>중간</em></p>',
    );
  });

  it("인라인 코드 안의 강조 문법과 SQL 식별자 underscore를 그대로 둔다", () => {
    expect(renderMarkdownInline("**굵게** *기울임* \`**코드**\` index_name")).toBe(
      "<strong>굵게</strong> <em>기울임</em> <code>**코드**</code> index_name",
    );
  });

  it("화자 사이의 문단·목록·코드·표를 각각 하나의 대화 turn으로 묶는다", () => {
    const html = renderMarkdown(`
**🤖 버디**
첫 문단입니다.

- 첫 항목
- 둘째 항목

\`\`\`sql
SELECT * FROM orders;
\`\`\`

| 이름 | 값 |
| --- | ---: |
| rows | 3 |

**🙋 나**
내 답변입니다.

> 추가 인용
`);

    expect(html.match(/class="md-dialogue-turn /g)).toHaveLength(2);
    expect(html.match(/role="listitem"/g)).toHaveLength(2);
    expect(html).toContain('role="list" aria-label="나와 버디의 대화"');
    expect(html).toContain('class="md-dialogue-turn md-dialogue-turn-buddy"');
    expect(html).toContain("<ul><li>첫 항목</li><li>둘째 항목</li></ul>");
    expect(html).toContain('<pre class="codeblock" data-language="sql"><code>');
    expect(html).toContain('<div class="md-table-wrap" role="region" aria-label="표">');
    expect(html).toContain('class="md-dialogue-turn md-dialogue-turn-me"');
    expect(html).not.toContain('aria-label="버디의 대화"');
    expect(html).not.toContain('aria-label="나의 대화"');
    expect(html.match(/class="md-dialogue-symbol"/g)).toHaveLength(2);
    expect(html).toContain("<blockquote><p>추가 인용</p></blockquote>");
    expect(html).not.toMatch(/[🤖🙋]/u);
  });

  it("코드 안의 화자 표식과 일반 강조 문구는 대화 turn으로 오인하지 않는다", () => {
    const html = renderMarkdown(`
\`\`\`md
**🤖 버디**
\`\`\`

**버디 전략**은 일반 문장입니다.

**나**
emoji 없는 일반 강조 표식입니다.
`);

    expect(html.match(/class="md-dialogue-turn /g) ?? []).toHaveLength(0);
    expect(html.replace(/<[^>]+>/g, "")).toContain("**🤖 버디**");
    expect(html).toContain("<strong>버디 전략</strong>");
    expect(html).toContain("<strong>나</strong> emoji 없는 일반 강조 표식입니다.");
  });
});
