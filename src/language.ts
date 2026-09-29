import { invalid } from './core.js';

export const languages = ['english', 'korean', 'vietnamese'] as const;
export type Language = (typeof languages)[number];

export function parseLanguage(value: string | undefined): Language {
  if (value === undefined) return 'english';
  const language = value.toLowerCase();
  if (languages.includes(language as Language)) return language as Language;
  throw invalid('language', 'language must be english, korean, or vietnamese.');
}

export const languageName: Record<Language, string> = {
  english: 'English',
  korean: 'Korean',
  vietnamese: 'Vietnamese',
};

type EvidenceText = { title: string; description: string };
type Copy = {
  summary: Record<'WARNING' | 'OFFICIAL' | 'VERIFIED_EMPLOYER' | 'UNVERIFIED', string>;
  risk: Record<string, string>;
  evidence: Record<string, EvidenceText>;
  sources: Record<string, string>;
  safetyGuidance: string;
  disclaimer: string;
};

export const copy: Record<Language, Copy> = {
  english: {
    summary: {
      WARNING: 'This offer has signals that need further checking.',
      OFFICIAL: 'This offer matches an active listing from an official source.',
      VERIFIED_EMPLOYER: 'This offer matches a verified employer domain.',
      UNVERIFIED: 'There is not enough evidence to verify this offer.',
    },
    risk: {
      UNKNOWN_EMPLOYER: 'The employer could not be matched to the company registry.',
      UNKNOWN_RECRUITER: 'The recruiter could not be identified.',
      NO_ORIGINAL_SOURCE:
        'The original listing could not be matched to a verified internal listing.',
      UNCLEAR_JOB_DUTIES: 'The job duties are not described clearly enough.',
      UNUSUAL_SALARY_PROMISE: 'Verify the high salary promise independently.',
      PAYMENT_REQUESTED: 'The offer asks for payment during recruitment.',
      DOCUMENT_REQUESTED_EARLY: 'The offer asks for sensitive documents before verification.',
      URGENCY_PRESSURE: 'The offer pressures you to decide immediately.',
      PRIVATE_COMMUNICATION: 'The offer directs you to a private communication channel.',
      TRAVEL_BEFORE_VERIFICATION:
        'The offer asks you to travel before confirming employment terms.',
    },
    evidence: {
      EMPLOYER_MATCH: {
        title: 'Employer matched',
        description: 'The employer matched a known company.',
      },
      EMPLOYER_UNKNOWN: {
        title: 'Employer unconfirmed',
        description: 'The employer could not be matched to a known company.',
      },
      RECRUITER_UNKNOWN: {
        title: 'Recruiter unconfirmed',
        description: 'Recruiter information was not provided.',
      },
      ORIGINAL_MATCH: {
        title: 'Original listing matched',
        description: 'The URL matched an active internal listing.',
      },
      ORIGINAL_UNKNOWN: {
        title: 'Original listing unconfirmed',
        description: 'No matching active internal listing was found.',
      },
    },
    sources: {
      'Company registry': 'Company registry',
      'Submitted offer': 'Submitted offer',
      'Internal job registry': 'Internal job registry',
    },
    safetyGuidance:
      'Contact the company through its official channel before sending money or sensitive documents.',
    disclaimer:
      'This result does not conclusively determine whether the offer is safe or fraudulent.',
  },
  korean: {
    summary: {
      WARNING: '확인이 필요한 위험 신호가 있습니다.',
      OFFICIAL: '활성 공식 출처의 원본 공고와 일치합니다.',
      VERIFIED_EMPLOYER: '확인된 회사 공식 도메인과 일치합니다.',
      UNVERIFIED: '충분한 근거를 확인하지 못했습니다.',
    },
    risk: {
      UNKNOWN_EMPLOYER: '등록된 회사와 일치하는 정보를 찾지 못했습니다.',
      UNKNOWN_RECRUITER: '모집자 신원을 확인할 수 없습니다.',
      NO_ORIGINAL_SOURCE: '내부 검증 공고와 원본을 대조할 수 없습니다.',
      UNCLEAR_JOB_DUTIES: '업무 내용이 충분히 설명되지 않았습니다.',
      UNUSUAL_SALARY_PROMISE: '높은 급여 약속을 독립적으로 확인해 주세요.',
      PAYMENT_REQUESTED: '채용 과정에서 금전 요구가 표시됩니다.',
      DOCUMENT_REQUESTED_EARLY: '검증 전 민감 서류 요구가 표시됩니다.',
      URGENCY_PRESSURE: '즉시 결정하라는 압박이 표시됩니다.',
      PRIVATE_COMMUNICATION: '비공식 개인 채널로 연락을 유도합니다.',
      TRAVEL_BEFORE_VERIFICATION: '고용 조건 확인 전 이동 요구가 표시됩니다.',
    },
    evidence: {
      EMPLOYER_MATCH: {
        title: '고용주 일치',
        description: '알려진 회사와 고용주 정보가 일치합니다.',
      },
      EMPLOYER_UNKNOWN: {
        title: '고용주 미확인',
        description: '알려진 회사와 고용주 정보를 대조할 수 없습니다.',
      },
      RECRUITER_UNKNOWN: {
        title: '모집자 미확인',
        description: '모집자 정보가 제공되지 않았습니다.',
      },
      ORIGINAL_MATCH: {
        title: '원본 공고 일치',
        description: '활성 내부 공고와 URL이 일치합니다.',
      },
      ORIGINAL_UNKNOWN: {
        title: '원본 공고 미확인',
        description: '일치하는 활성 내부 공고를 찾지 못했습니다.',
      },
    },
    sources: {
      'Company registry': '회사 등록 정보',
      'Submitted offer': '제출된 제안',
      'Internal job registry': '내부 공고 목록',
    },
    safetyGuidance: '금전이나 민감 문서를 보내기 전에 회사의 공식 채널로 직접 확인하세요.',
    disclaimer: '이 결과는 안전 또는 사기 여부를 확정하지 않습니다.',
  },
  vietnamese: {
    summary: {
      WARNING: 'Có dấu hiệu rủi ro cần kiểm tra thêm.',
      OFFICIAL: 'Thông tin này khớp với tin tuyển dụng đang hoạt động từ nguồn chính thức.',
      VERIFIED_EMPLOYER: 'Thông tin này khớp với tên miền của nhà tuyển dụng đã được xác minh.',
      UNVERIFIED: 'Chưa có đủ bằng chứng để xác minh thông tin này.',
    },
    risk: {
      UNKNOWN_EMPLOYER: 'Không thể đối chiếu nhà tuyển dụng với dữ liệu doanh nghiệp.',
      UNKNOWN_RECRUITER: 'Không thể xác định người tuyển dụng.',
      NO_ORIGINAL_SOURCE: 'Không thể đối chiếu tin gốc với tin đã xác minh trong hệ thống.',
      UNCLEAR_JOB_DUTIES: 'Nhiệm vụ công việc chưa được mô tả đủ rõ.',
      UNUSUAL_SALARY_PROMISE: 'Hãy kiểm chứng độc lập lời hứa về mức lương cao.',
      PAYMENT_REQUESTED: 'Thông tin tuyển dụng yêu cầu thanh toán.',
      DOCUMENT_REQUESTED_EARLY: 'Thông tin tuyển dụng yêu cầu giấy tờ nhạy cảm trước khi xác minh.',
      URGENCY_PRESSURE: 'Thông tin tuyển dụng thúc ép quyết định ngay lập tức.',
      PRIVATE_COMMUNICATION: 'Thông tin tuyển dụng hướng đến kênh liên lạc cá nhân.',
      TRAVEL_BEFORE_VERIFICATION:
        'Thông tin tuyển dụng yêu cầu di chuyển trước khi xác nhận điều kiện làm việc.',
    },
    evidence: {
      EMPLOYER_MATCH: {
        title: 'Đã đối chiếu nhà tuyển dụng',
        description: 'Nhà tuyển dụng khớp với doanh nghiệp đã biết.',
      },
      EMPLOYER_UNKNOWN: {
        title: 'Chưa xác minh nhà tuyển dụng',
        description: 'Không thể đối chiếu nhà tuyển dụng với doanh nghiệp đã biết.',
      },
      RECRUITER_UNKNOWN: {
        title: 'Chưa xác minh người tuyển dụng',
        description: 'Không có thông tin về người tuyển dụng.',
      },
      ORIGINAL_MATCH: {
        title: 'Đã đối chiếu tin gốc',
        description: 'Đường dẫn khớp với tin đang hoạt động trong hệ thống.',
      },
      ORIGINAL_UNKNOWN: {
        title: 'Chưa xác minh tin gốc',
        description: 'Không tìm thấy tin đang hoạt động tương ứng trong hệ thống.',
      },
    },
    sources: {
      'Company registry': 'Dữ liệu doanh nghiệp',
      'Submitted offer': 'Thông tin đã gửi',
      'Internal job registry': 'Danh sách việc làm nội bộ',
    },
    safetyGuidance:
      'Hãy liên hệ công ty qua kênh chính thức trước khi gửi tiền hoặc giấy tờ nhạy cảm.',
    disclaimer:
      'Kết quả này không khẳng định chắc chắn thông tin tuyển dụng là an toàn hay lừa đảo.',
  },
};
