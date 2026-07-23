/**
 * app.js — Bảng tính giá căn hộ Sun Urban City.
 *
 * Toàn bộ logic tính giá nằm ở đây (không có backend). Luồng chính:
 *   input người dùng -> calculate() -> object kết quả -> render() vẽ ra DOM.
 *
 * Quy ước tiền tệ trong file:
 *   - "net"   : giá chưa VAT, chưa phí bảo trì (KPBT).
 *   - "gross" : giá đã gồm VAT.
 *   - VAT = 10%, KPBT = 2%  => giá gồm cả hai = net * 1.12.
 */

/**
 * Bảng chính sách theo từng nhóm toà. Mỗi nhóm là một cấu hình chiết khấu riêng.
 *
 * Ý nghĩa các field (chung cho mọi nhóm):
 *   - name              : tên hiển thị của nhóm toà.
 *   - hasCompletion     : toà có bán kèm gói nội thất/hoàn thiện hay không.
 *   - completionMode    : cách tính giá gói hoàn thiện.
 *                         "grossPlusMaintenance" -> completionUnits là ĐƠN GIÁ ĐÃ GỒM VAT.
 *                         "netTimes112"          -> completionUnits là ĐƠN GIÁ NET (chưa VAT).
 *                         "none"                 -> không có gói hoàn thiện.
 *   - completionDiscount: tỷ lệ CK áp cho gói hoàn thiện (tính trên giá net còn lại).
 *   - noLoanDiscount    : tỷ lệ CK khi khách KHÔNG vay.
 *   - fixedDiscounts    : số tiền CK cố định theo loại căn (đơn vị VND).
 *   - completionUnits   : đơn giá gói hoàn thiện theo loại căn (VND/m²); ý nghĩa net/gross tuỳ completionMode.
 *   - ttsJuly           : tỷ lệ CK theo hình thức thanh toán sớm (TTS) tại MỐC tháng 7/2026.
 *   - handover          : ngày bàn giao dự kiến (YYYY-MM-DD).
 *   - loanSupport       : mô tả gói hỗ trợ lãi suất (HTLS).
 *   - earlyBird         : (tuỳ chọn) tỷ lệ CK "đặt sớm", chỉ có ở một số toà.
 */
const policies = {
  P3P9: {
    name: "P3-P9",
    hasCompletion: true,               // có gói hoàn thiện
    completionMode: "grossPlusMaintenance", // đơn giá completionUnits là giá đã gồm VAT
    completionDiscount: 0.07,          // CK gói hoàn thiện 7%
    noLoanDiscount: 0.05,              // CK không vay 5%
    fixedDiscounts: { Studio: 70000000, "1BR+": 100000000, "2BR": 150000000 }, // CK cố định theo loại căn (VND)
    completionUnits: { Studio: 5100000, "1BR+": 4600000, "2BR": 5400000 },     // đơn giá hoàn thiện đã gồm VAT (VND/m²)
    ttsJuly: { tts95: 0.125, tts70: 0.10, tts50: 0.08 }, // CK TTS tại mốc 7/2026
    handover: "2027-05-30",            // ngày bàn giao
    loanSupport: "HTLS 24 tháng, không muộn hơn 15/08/2028",
  },
  P10P18: {
    name: "P10/P16/P18",
    hasCompletion: true,
    completionMode: "netTimes112",     // đơn giá completionUnits là giá NET (chưa VAT)
    completionDiscount: 0.03,          // CK gói hoàn thiện 3%
    noLoanDiscount: 0.05,
    fixedDiscounts: {},                // nhóm này không có CK cố định theo loại căn
    completionUnits: { Studio: 4722222, "1BR+": 4259259, "2BR": 5000000 },     // đơn giá hoàn thiện NET (VND/m²)
    ttsJuly: { tts95: 0.095, tts70: 0.065, tts50: 0.035 },
    handover: "2027-09-30",
    loanSupport: "HTLS 24 tháng, không muộn hơn 15/07/2028",
  },
  P7P15P19: {
    name: "P7/P15/P19",
    hasCompletion: false,              // không có gói hoàn thiện
    completionMode: "none",
    completionDiscount: 0,
    noLoanDiscount: 0.05,
    fixedDiscounts: {},
    completionUnits: {},
    ttsJuly: { tts95: 0.115, tts70: 0.065, tts50: 0.035 },
    earlyBird: 0.01,                   // CK đặt sớm 1%
    handover: "2027-09-30",
    loanSupport: "HTLS 30 tháng, không quá 31/10/2028",
  },
  P24P26: {
    name: "P24/P25/P26",
    hasCompletion: false,
    completionMode: "none",
    completionDiscount: 0,
    noLoanDiscount: 0.05,
    fixedDiscounts: {},
    completionUnits: {},
    ttsJuly: { tts95: 0.105, tts70: 0.055, tts50: 0.025 },
    earlyBird: 0.01,                   // CK đặt sớm 1%
    handover: "2028-12-31",
    loanSupport: "HTLS 30 tháng, không quá 31/10/2028",
  },
};

// Số tiền cọc theo loại căn (đơn vị VND).
const depositByType = {
  Studio: 50000000,
  "1BR+": 100000000,
  "2BR": 150000000,
};

// Nhãn hiển thị cho từng phương án thanh toán (khớp với data-scenario ở HTML).
// 3 mức TTS gộp chung 1 tab "tts"; mức 50/70/95 lấy từ ô nhập -> nhãn dựng động.
const scenarioLabels = {
  loan: "Có vay",
  standard: "Không vay",
  tts: "TTS",
};

// Nhãn phương án đang chọn để hiển thị; riêng "tts" gắn thêm mức % đang nhập ("TTS 50%").
function currentScenarioLabel() {
  if (activeScenario === "tts") return `TTS ${parseNumber(els.ttsPercent.value) || 0}%`;
  return scenarioLabels[activeScenario] || activeScenario;
}

// Cache tham chiếu tới các phần tử DOM dùng nhiều lần (tránh querySelector lặp lại).
const els = {
  unitCode: document.querySelector("#unitCode"),         // mã căn
  policyGroup: document.querySelector("#policyGroup"),   // nhóm toà (key của `policies`)
  unitType: document.querySelector("#unitType"),         // loại căn (Studio/1BR+/2BR)
  area: document.querySelector("#area"),                 // diện tích (m²)
  quoteDate: document.querySelector("#quoteDate"),       // ngày báo giá
  listedGross: document.querySelector("#listedGross"),   // giá niêm yết đã gồm VAT/KPBT
  baseNet: document.querySelector("#baseNet"),           // giá net (tự tính từ listedGross)
  bankGuarantee: document.querySelector("#bankGuarantee"),// tuỳ chọn cộng 1% bảo lãnh NH
  discountInputs: document.querySelector("#discountInputs"), // khối ô CK (hiện ở "Có vay" & "Không vay")
  ebField: document.querySelector("#ebField"),           // ô "CK Early Bird" (chỉ hiện khi nhóm toà có EB)
  earlyBirdRate: document.querySelector("#earlyBirdRate"),// % CK Early Bird (nhập tay, mặc định theo nhóm toà)
  noLoanField: document.querySelector("#noLoanField"),   // ô "CK không vay" (chỉ hiện ở tab "Không vay")
  noLoanRate: document.querySelector("#noLoanRate"),     // % CK không vay (nhập tay, mặc định theo nhóm toà)
  guaranteeRate: document.querySelector("#guaranteeRate"),// % CK bảo lãnh NH (nhập tay, mặc định 1%)
  ttsField: document.querySelector("#ttsField"),         // ô "TTS" (chỉ hiện ở tab "TTS")
  ttsPercent: document.querySelector("#ttsPercent"),     // mức TTS 50/70/95 (datalist, mặc định 50)
  loanRatio: document.querySelector("#loanRatio"),       // tỷ lệ vay (%)
  totalPrice: document.querySelector("#totalPrice"),     // ô hiển thị tổng giá
  upfrontPrice: document.querySelector("#upfrontPrice"), // ô hiển thị tiền trước
  resultRows: document.querySelector("#resultRows"),     // vùng render kết quả chính
  discountRows: document.querySelector("#discountRows"), // vùng render chi tiết chiết khấu
  scheduleRows: document.querySelector("#scheduleRows"), // vùng render tiến độ thanh toán
  copyBtn: document.querySelector("#copyBtn"),           // nút copy báo giá
  resetBtn: document.querySelector("#resetBtn"),         // nút nhập lại
  toast: document.querySelector("#toast"),               // hộp thông báo nhanh
};

let activeScenario = "loan"; // phương án đang chọn (key trong scenarioLabels)
let lastQuoteText = "";       // văn bản báo giá gần nhất, dùng cho nút Copy

/**
 * Chuyển chuỗi tiền (có thể chứa dấu phẩy ngăn cách nghìn) thành số.
 * Nếu đã là số thì trả về nguyên vẹn.
 */
function parseMoney(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^\d.-]/g, "");
  return Number(cleaned || 0);
}

/**
 * Chuyển chuỗi số thành số, chấp nhận dấu phẩy làm dấu thập phân
 * (ví dụ "29,70" -> 29.70). Dùng cho diện tích và tỷ lệ.
 */
function parseNumber(value) {
  const cleaned = String(value || "").replace(",", ".").replace(/[^\d.-]/g, "");
  return Number(cleaned || 0);
}

// Làm tròn về số nguyên (mọi tiền tệ đều tính theo VND nguyên).
function round(value) {
  return Math.round(Number(value || 0));
}

// Format số thành chuỗi tiền kiểu Việt Nam, kèm hậu tố " đ".
function money(value) {
  return `${round(value).toLocaleString("vi-VN")} đ`;
}

// Format số cho ô input (phân tách nghìn kiểu en-US); trả về rỗng nếu bằng 0.
function inputMoney(value) {
  const rounded = round(value);
  return rounded ? rounded.toLocaleString("en-US") : "";
}

// Format tỷ lệ thập phân (0.07) thành chuỗi phần trăm ("7%").
function percent(value) {
  return `${(value * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
}

/**
 * Parse chuỗi ngày "YYYY-MM-DD" thành Date theo giờ địa phương
 * (tự tách tay để tránh lệch múi giờ khi dùng new Date(chuỗi)).
 * Có giá trị fallback nếu chuỗi không hợp lệ.
 */
function dateFromText(dateText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ""));
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(dateText || "2026-07-08");
  if (Number.isNaN(parsed.getTime())) return new Date(2026, 6, 8);
  return parsed;
}

// Trả về một Date mới = ngày đã cho cộng thêm `days` ngày (không sửa ngày gốc).
function addDays(dateValue, days) {
  const d = dateValue instanceof Date ? new Date(dateValue) : dateFromText(dateValue);
  d.setDate(d.getDate() + days);
  return d;
}

// Format Date thành chuỗi "dd/mm/yyyy" để hiển thị.
function formatDateText(dateValue) {
  const d = dateValue instanceof Date ? dateValue : dateFromText(dateValue);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

/**
 * Chia đều `count` mốc ngày giữa start và end (bao gồm cả hai đầu).
 * Nếu end <= start thì tự giãn mỗi mốc cách nhau 30 ngày kể từ start.
 */
function spreadDates(startValue, endValue, count) {
  const start = startValue instanceof Date ? new Date(startValue) : dateFromText(startValue);
  let end = endValue instanceof Date ? new Date(endValue) : dateFromText(endValue);
  if (end.getTime() <= start.getTime()) {
    end = addDays(start, (count - 1) * 30);
  }
  const step = (end.getTime() - start.getTime()) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => new Date(start.getTime() + step * index));
}

// Tính "giá chưa VAT/KPBT" = giá niêm yết / 1.12 (VAT 10% + KPBT 2%) và đổ vào ô baseNet.
function syncBaseFromGross() {
  els.baseNet.value = inputMoney(parseMoney(els.listedGross.value) / 1.12);
}

// Đổi tỷ lệ thập phân (0.05) thành chuỗi % để đổ vào ô nhập ("5"), giữ tối đa 2 số lẻ.
function rateToInput(rate) {
  return String(round((rate || 0) * 10000) / 100);
}

// Đổ mức CK phụ thuộc nhóm toà (EB + không vay) vào ô nhập. Gọi khi đổi nhóm toà.
function syncPolicyDiscountRates() {
  const policy = policies[els.policyGroup.value];
  els.earlyBirdRate.value = rateToInput(policy.earlyBird);
  els.noLoanRate.value = rateToInput(policy.noLoanDiscount);
}

// Reset toàn bộ ô CK về mặc định (EB + không vay theo nhóm toà, BLNH 1% + bật checkbox).
// Gọi khi chuyển tab phương án và khi nhấn "nhập lại".
function resetDiscountInputs() {
  syncPolicyDiscountRates();
  els.guaranteeRate.value = "1";
  els.bankGuarantee.checked = true;
  els.ttsPercent.value = "0";
}

// Chuẩn hoá lại giá trị đang có trong một ô input tiền (phân tách nghìn).
function formatMoneyInput(input) {
  input.value = inputMoney(parseMoney(input.value));
}

// Số tháng chênh lệch giữa `dateText` và mốc tháng 7/2026 (có thể âm nếu trước mốc).
function monthDiffFromJuly2026(dateText) {
  const d = new Date(dateText || "2026-07-01");
  if (Number.isNaN(d.getTime())) return 0;
  return (d.getFullYear() - 2026) * 12 + (d.getMonth() - 6);
}

/**
 * Tỷ lệ CK theo hình thức thanh toán sớm (TTS), "cuốn chiếu" theo thời gian:
 * lấy mức tại mốc 7/2026 rồi giảm 0.5% cho mỗi tháng trôi qua, không xuống dưới 0.
 * Chỉ áp cho các phương án tts50/tts70/tts95.
 */
function rollingTtsRate(policy, scenario, dateText) {
  if (!["tts50", "tts70", "tts95"].includes(scenario)) return 0;
  const base = policy.ttsJuly[scenario] || 0;
  const months = Math.max(0, monthDiffFromJuly2026(dateText));
  return Math.max(0, base - months * 0.005);
}

/**
 * Tách giá gói hoàn thiện thành 2 phần: phần gross (đã gồm VAT) và phí bảo trì (KPBT).
 * Cách tính phụ thuộc completionMode của nhóm toà (xem legend ở `policies`).
 * Trả về { grossWithVat, maintenance, total } (total = gross + KPBT).
 */
function completionBreakdown(policy, unitType, area) {
  if (!policy.hasCompletion) return { grossWithVat: 0, maintenance: 0, total: 0 };
  const unit = policy.completionUnits[unitType] || 0;
  let grossWithVat = 0;
  let maintenance = 0;
  if (policy.completionMode === "grossPlusMaintenance") {
    // unit đã gồm VAT: gross = unit*area; net = unit/1.1; KPBT = net*2%.
    grossWithVat = round(unit * area);
    maintenance = round((unit / 1.1) * area * 0.02);
  } else if (policy.completionMode === "netTimes112") {
    // unit là net: gross = net*1.1 (VAT 10%); KPBT = net*2%.
    const net = unit * area;
    grossWithVat = round(net * 1.1);
    maintenance = round(net * 0.02);
  }
  return { grossWithVat, maintenance, total: grossWithVat + maintenance };
}

// Tổng giá gói hoàn thiện (gross + KPBT) — dùng khi chỉ cần con số tổng.
function completionValue(policy, unitType, area) {
  return completionBreakdown(policy, unitType, area).total;
}

/**
 * Dựng bảng tiến độ thanh toán chi tiết cho phương án "Không vay" (standard).
 * Nhận vào object `result` (một phần kết quả của calculate) và trả về mảng [nhãn, số tiền].
 * Các mốc ngày được giãn đều từ ngày báo giá tới trước ngày bàn giao 14 ngày.
 */
function buildStandardSchedule(result) {
  const deposit = depositByType[result.unitType] || 0;
  const quoteDate = dateFromText(els.quoteDate.value);
  const handoverDate = dateFromText(result.policy.handover);
  const secondDate = addDays(quoteDate, 9);                 // đợt 2: sau ngày báo giá 9 ngày
  // 15 đợt trả góp, giãn đều từ (đợt 2 + 60 ngày) tới (bàn giao - 14 ngày).
  const installmentDates = spreadDates(addDays(secondDate, 60), addDays(handoverDate, -14), 15);
  const completion = completionBreakdown(result.policy, result.unitType, result.area);

  const rows = [
    [`Cọc (${formatDateText(quoteDate)})`, deposit],
    [`Lần 2 - 15% (${formatDateText(secondDate)})`, round(result.rawWithVat * 0.15 - deposit)],
  ];

  // Nếu có gói hoàn thiện: đóng 70% phần hoàn thiện khi ký HĐMB.
  if (completion.total) {
    rows.push([
      `Ký HĐMB - 70% hoàn thiện (${formatDateText(addDays(secondDate, 3))})`,
      round(completion.grossWithVat * 0.70),
    ]);
  }

  // Đợt 3: 10% giá gross; sau đó 14 đợt mỗi đợt 5%.
  rows.push([`Lần 3 - 10% (${formatDateText(installmentDates[0])})`, round(result.rawWithVat * 0.10)]);
  for (let index = 0; index < 14; index += 1) {
    rows.push([
      `Lần ${index + 4} - 5% (${formatDateText(installmentDates[index + 1])})`,
      round(result.rawWithVat * 0.05),
    ]);
  }

  // Khi bàn giao: đóng KPBT + 5% thuế còn lại + 30% hoàn thiện + KPBT hoàn thiện.
  rows.push([
    `Bàn giao - KPBT + thuế 5% (${formatDateText(handoverDate)})`,
    round(result.maintenance + result.vat * 0.05 + completion.grossWithVat * 0.30 + completion.maintenance),
  ]);
  rows.push([`5% GCN (${formatDateText(handoverDate)})`, round(result.netAfterDiscount * 0.05)]);

  // Bù chênh lệch do làm tròn: dồn phần lệch vào dòng "Bàn giao" (dòng áp chót)
  // để tổng các đợt khớp đúng bằng result.total.
  const totalRows = rows.reduce((sum, [, amount]) => sum + round(amount), 0);
  const diff = result.total - totalRows;
  if (diff) rows[rows.length - 2][1] = round(rows[rows.length - 2][1] + diff);

  return rows;
}

/**
 * Áp một khoản chiết khấu lên `base` và (nếu > 0) ghi vào danh sách `items`.
 * - isRate = true : rateOrAmount là tỷ lệ (nhân với base).
 * - isRate = false: rateOrAmount là số tiền tuyệt đối.
 * Trả về phần còn lại sau khi trừ khoản CK.
 */
function applyDiscount(items, label, rateOrAmount, base, isRate = true) {
  const amount = isRate ? round(base * rateOrAmount) : round(rateOrAmount);
  if (amount > 0) {
    items.push({ label, amount, rate: isRate ? rateOrAmount : null });
  }
  return base - amount;
}

/**
 * Tính toàn bộ báo giá cho một phương án.
 * `options` cho phép override khi gọi nội bộ (scenario, includeGuarantee);
 * mặc định đọc trực tiếp từ DOM/state.
 * Trả về object đầy đủ để render() và makeQuoteText() sử dụng.
 */
function calculate(options = {}) {
  const policy = policies[els.policyGroup.value];
  const unitType = els.unitType.value;
  const area = parseNumber(els.area.value);
  const baseNet = parseMoney(els.baseNet.value);
  const loanRatio = Math.max(0, Math.min(100, parseNumber(els.loanRatio.value))) / 100; // kẹp 0..100 rồi đổi ra tỷ lệ
  const scenario = options.scenario || activeScenario;
  const includeGuarantee = options.includeGuarantee ?? els.bankGuarantee.checked;
  const discounts = [];

  // Áp lần lượt các khoản chiết khấu lên giá net, theo thứ tự nghiệp vụ.
  let remaining = baseNet;
  const fixed = policy.fixedDiscounts[unitType] || 0;
  remaining = applyDiscount(discounts, `CK loại căn ${unitType}`, fixed, remaining, false); // CK cố định (số tiền)

  // CK Early Bird: lấy % từ ô nhập (mặc định = policy.earlyBird, người dùng có thể sửa).
  const earlyBirdRate = parseNumber(els.earlyBirdRate.value) / 100;
  if (earlyBirdRate > 0) {
    remaining = applyDiscount(discounts, `Early Bird ${percent(earlyBirdRate)}`, earlyBirdRate, remaining);
  }

  if (policy.completionDiscount) {
    remaining = applyDiscount(
      discounts,
      `CK gói hoàn thiện ${percent(policy.completionDiscount)}`,
      policy.completionDiscount,
      remaining
    );
  }

  // CK không vay: áp cho mọi phương án khác "Có vay"; lấy % từ ô nhập (mặc định = policy.noLoanDiscount).
  if (scenario !== "loan") {
    const noLoanRate = parseNumber(els.noLoanRate.value) / 100;
    if (noLoanRate > 0) {
      remaining = applyDiscount(discounts, `Không vay ${percent(noLoanRate)}`, noLoanRate, remaining);
    }
  }

  // CK bảo lãnh NH: checkbox bật/tắt, ô nhập quyết định % (mặc định 1%).
  const guaranteeRate = parseNumber(els.guaranteeRate.value) / 100;
  if (includeGuarantee && guaranteeRate > 0) {
    remaining = applyDiscount(discounts, `CK bảo lãnh NH ${percent(guaranteeRate)}`, guaranteeRate, remaining);
  }

  // CK TTS (chỉ ở tab "TTS"): gõ thẳng % muốn áp, tính trực tiếp theo % nhập
  // (không tra bảng ttsJuly, không cuốn chiếu).
  const ttsRate = scenario === "tts" ? parseNumber(els.ttsPercent.value) / 100 : 0;
  if (ttsRate > 0) {
    remaining = applyDiscount(discounts, `CK TTS ${percent(ttsRate)}`, ttsRate, remaining);
  }

  // Sau khi trừ hết CK: cộng thuế/phí và giá hoàn thiện để ra tổng giá.
  const netAfterDiscount = round(remaining);
  const vat = round(netAfterDiscount * 0.10);              // VAT 10%
  const maintenance = round(netAfterDiscount * 0.02);      // KPBT 2%
  const rawGrossAfterDiscount = netAfterDiscount + vat + maintenance; // giá thô (chưa gồm hoàn thiện)
  const completion = completionValue(policy, unitType, area);
  const total = rawGrossAfterDiscount + completion;        // tổng giá thanh toán
  const rawWithVat = netAfterDiscount + vat;               // giá gồm VAT nhưng chưa KPBT
  const bankDisbursement = scenario === "loan" ? round(rawWithVat * loanRatio) : 0; // NH giải ngân
  const deposit = depositByType[unitType] || 0;

  let upfront = 0;
  let schedule = [];
  if (scenario === "loan") {
    // Tiến độ khi có vay: các đợt trước giải ngân tính trên giá TRƯỚC khi trừ 1% bảo lãnh
    // -> nếu đang tính có bảo lãnh, tính lại một lần không bảo lãnh để lấy cơ sở.
    const noGuarantee = includeGuarantee
      ? calculate({ scenario: "loan", includeGuarantee: false })
      : null;
    const basis = noGuarantee || { netAfterDiscount, vat };
    const basisRawWithVat = basis.netAfterDiscount + basis.vat;
    const payment2 = round(basisRawWithVat * 0.15 - deposit); // đợt 2: 15% - cọc
    const payment4 = round(basisRawWithVat * 0.10);           // đợt 4: 10%
    upfront = deposit + payment2 + payment4;                  // tiền khách bỏ ra trước giải ngân

    schedule = [
      ["Cọc", deposit],
      ["Lần 2", payment2],
      ["HĐMB - 70% nội thất", round(completion * 0.70)],
      ["NH giải ngân", bankDisbursement],
      ["Lần 4", payment4],
      ["Bàn giao", round(maintenance + vat * 0.05 + completion * 0.30)],
      ["5% GCN", round(netAfterDiscount * 0.05)],
    ];
  } else if (scenario === "standard") {
    // Không vay: dùng bảng tiến độ chi tiết theo mốc ngày.
    schedule = buildStandardSchedule({
      policy,
      unitType,
      area,
      netAfterDiscount,
      vat,
      maintenance,
      total,
      rawWithVat,
    });
  } else {
    // Các phương án TTS: chỉ hiển thị tổng, cọc và phần còn lại.
    schedule = [
      ["Tổng giá", total],
      ["Cọc", deposit],
      ["Còn lại sau cọc", Math.max(0, total - deposit)],
    ];
  }

  return {
    policy,
    scenario,
    unitType,
    area,
    baseNet,
    discounts,
    netAfterDiscount,
    vat,
    maintenance,
    rawGrossAfterDiscount,
    completion,
    total,
    rawWithVat,
    bankDisbursement,
    upfront,
    schedule,
    ttsRate,
  };
}

// Tạo một dòng HTML dạng nhãn / giá trị (dùng lại cho cả 3 vùng kết quả).
function row(label, value, className = "") {
  return `<div class="row ${className}"><span>${label}</span><strong>${value}</strong></div>`;
}

/**
 * Đọc input hiện tại, gọi calculate() rồi vẽ toàn bộ kết quả ra DOM:
 * summary (tổng/tiền trước), khối kết quả, chi tiết CK và tiến độ.
 * Được gọi lại mỗi khi có thay đổi input.
 */
function render() {
  const result = calculate();
  // Ô CK hiện theo tab VÀ theo việc nhóm toà có khoản đó hay không:
  //  - EB: chỉ căn có policy.earlyBird.
  //  - Không vay: mọi tab trừ "Có vay", và căn có policy.noLoanDiscount.
  //  - BLNH: CK cố định áp mọi căn -> luôn hiện.
  //  - TTS: chỉ ở tab "TTS".
  // Số cột grid đổi theo số ô thực tế đang hiện (3 ô -> 3 cột, còn lại -> 2 cột/2x2).
  const isTts = activeScenario === "tts";
  const showEb = !!result.policy.earlyBird;
  const showNoLoan = activeScenario !== "loan" && !!result.policy.noLoanDiscount;
  const showTts = isTts;
  els.ebField.style.display = showEb ? "" : "none";
  els.noLoanField.style.display = showNoLoan ? "" : "none";
  els.ttsField.style.display = showTts ? "" : "none";
  const visibleCount = [showEb, showNoLoan, true, showTts].filter(Boolean).length; // +1 cho BLNH luôn hiện
  els.discountInputs.classList.toggle("three", visibleCount === 3);
  els.discountInputs.classList.toggle("two", visibleCount !== 3);
  els.totalPrice.textContent = money(result.total);
  els.upfrontPrice.textContent = activeScenario === "loan" ? money(result.upfront) : "";

  const rows = [
    row("Phương án", currentScenarioLabel(), "highlight"),
    row("Nhóm toà", result.policy.name),
    row("Giá thô sau CK", money(result.rawGrossAfterDiscount)),
    row("Giá nội thất/hoàn thiện", money(result.completion)),
    row("Tổng giá thanh toán", money(result.total), "highlight"),
  ];
  if (activeScenario === "loan") {
    rows.push(row("Tiền trước de bao", money(result.upfront), "highlight"));
    rows.push(row("Ngân hàng giải ngân", money(result.bankDisbursement)));
  }
  if (result.ttsRate) {
    rows.push(row("Tỷ lệ TTS đang áp dụng", percent(result.ttsRate)));
  }
  if (activeScenario === "loan") {
    rows.push(row("HTLS", result.policy.loanSupport));
  }
  els.resultRows.innerHTML = rows.join("");

  // Chi tiết từng khoản chiết khấu + các dòng thuế/phí ở cuối.
  const discountRows = result.discounts.map((item) => {
    const label = item.rate ? `${item.label}` : item.label;
    return row(label, money(item.amount));
  });
  discountRows.push(row("Giá chưa VAT/KPBT sau CK", money(result.netAfterDiscount), "highlight"));
  discountRows.push(row("VAT 10%", money(result.vat)));
  discountRows.push(row("KPBT 2%", money(result.maintenance)));
  els.discountRows.innerHTML = discountRows.join("");

  // Tiến độ thanh toán; tô đậm các mốc quan trọng (NH giải ngân, Tổng, Tiền, Bàn giao, GCN).
  els.scheduleRows.innerHTML = result.schedule.map(([label, value]) => {
    const className = /NH|Tổng|Tiền|Bàn giao|GCN/.test(label) ? "highlight" : "";
    return row(label, money(value), className);
  }).join("");

  lastQuoteText = makeQuoteText(result);
}

/**
 * Tạo văn bản báo giá (nhiều dòng) để copy cho khách.
 * Nội dung phụ thuộc phương án đang chọn.
 */
function makeQuoteText(result) {
  const parts = [
    `${els.unitCode.value.trim() || "Căn hộ"} - ${result.policy.name}`,
    `Phương án: ${currentScenarioLabel()}`,
    `Tổng giá: ${money(result.total)}`,
  ];
  if (activeScenario === "loan") {
    parts.push(`Tiền trước: ${money(result.upfront)}`);
    parts.push(`NH giải ngân: ${money(result.bankDisbursement)}`);
    parts.push(`HTLS: ${result.policy.loanSupport}`);
  }
  parts.push(`Giá thô sau CK: ${money(result.rawGrossAfterDiscount)}`);
  if (result.completion) parts.push(`Nội thất/hoàn thiện: ${money(result.completion)}`);
  return parts.join("\n");
}

// Hiện thông báo nhanh (toast) trong ~1.8 giây.
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

// Đặt lại toàn bộ input về giá trị mặc định rồi render lại.
function resetDefaults() {
  els.unitCode.value = "P90316";
  els.policyGroup.value = "P3P9";
  els.unitType.value = "Studio";
  els.area.value = "29.70";
  els.quoteDate.value = "2026-07-08";
  els.listedGross.value = "1,671,152,684";
  syncBaseFromGross();
  resetDiscountInputs();
  els.loanRatio.value = "70";
  activeScenario = "loan";
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === activeScenario);
  });
  render();
}

// Mỗi input/select: cập nhật lại kết quả khi người dùng gõ (input) hoặc rời ô (change).
document.querySelectorAll("input, select").forEach((input) => {
  input.addEventListener("input", () => {
    if (input === els.listedGross) {
      // Định dạng lại ô giá niêm yết ngay khi gõ, giữ con trỏ ở cuối nếu đang ở cuối.
      const cursorAtEnd = input.selectionStart === input.value.length;
      formatMoneyInput(input);
      if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
      syncBaseFromGross();
    }
    render();
  });
  input.addEventListener("change", () => {
    if (input.matches?.("[data-money-input]")) {
      formatMoneyInput(input);
    }
    if (input === els.listedGross) {
      syncBaseFromGross();
    }
    if (input === els.policyGroup) {
      syncPolicyDiscountRates(); // đổi nhóm toà -> đưa ô EB + không vay về mức mặc định của toà đó
    }
    render();
  });
});

// Nút chọn phương án: cập nhật activeScenario và trạng thái active của nút.
document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    activeScenario = button.dataset.scenario;
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    resetDiscountInputs(); // chuyển tab -> reset toàn bộ ô CK về mặc định
    render();
  });
});

// Nút "nhập lại".
els.resetBtn.addEventListener("click", resetDefaults);

// Nút "Copy báo giá": ghi văn bản báo giá gần nhất vào clipboard.
els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastQuoteText);
    showToast("Đã copy báo giá");
  } catch {
    showToast("Không copy được trên trình duyệt này");
  }
});

// Đăng ký service worker cho PWA (bỏ qua lỗi nếu file service-worker.js không tồn tại).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

// Khởi tạo lần đầu khi tải trang: đồng bộ giá net, mức CK theo toà, định dạng các ô tiền và render.
syncBaseFromGross();
syncPolicyDiscountRates();
document.querySelectorAll("[data-money-input]").forEach(formatMoneyInput);
render();
