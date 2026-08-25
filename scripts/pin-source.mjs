// 새 출처의 검토 스냅샷 줄을 만든다. 지식 문서를 새로 쓸 때 `## 출처` 절에 붙일 값이다.
// 원문을 가져와 injection·secret 검사를 통과하는지 확인한 뒤 해시를 출력한다.
import {
  detectRawHtmlPromptInjection,
  detectRawHtmlSecret,
  extractMetadata,
  fetchAllowlistedHtml,
  sha256
} from './lib.mjs';

const [id, url] = process.argv.slice(2);
if (!id || !url) {
  console.error('Usage: node scripts/pin-source.mjs <출처 id> <URL>');
  process.exit(1);
}

const { html } = await fetchAllowlistedHtml(url);
const injection = detectRawHtmlPromptInjection(html);
const secret = detectRawHtmlSecret(html);
if (injection) console.error(`주의: prompt-injection 패턴 감지 (${injection}) — 원문을 직접 확인하세요.`);
if (secret) console.error(`주의: secret 형태 패턴 감지 (${secret}) — 원문을 직접 확인하세요.`);

const metadata = extractMetadata(html);
const structure = sha256(
  JSON.stringify({
    title: metadata.title,
    description: metadata.description.slice(0, 800),
    headings: metadata.headings
  })
);
const body = sha256(metadata.normalizedText);
console.log(`- 검토 스냅샷: \`${id}\` 구조 \`${structure.slice(0, 12)}\` 본문 \`${body.slice(0, 12)}\``);
console.error(`제목: ${metadata.title}`);
console.error(`헤딩 ${metadata.headings.length}개`);
