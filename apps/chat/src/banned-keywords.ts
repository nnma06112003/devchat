/**
 * Danh sách từ khóa bị cấm trong hệ thống chat
 * Bao gồm từ ngữ thô tục, xúc phạm, đe dọa và spam
 */

export const BANNED_KEYWORDS_VI = [
  // Từ tục tĩu cơ bản
  'đụ', 'má', 'đit', 'dit', 'lồn', 'lon', 'buồi', 'buoi', 'cặc', 'cac', 
  'đéo', 'deo', 'đm', 'dm', 'đcm', 'dcm', 'đkm', 'dkm', 'đjt', 'djt',
  'cc', 'vcl', 'vl', 'cl', 'vãi', 'vai', 'đần', 'dan',
  
  // Cụm từ tục tĩu
  'du ma', 'đụ má', 'du me', 'đụ mẹ', 'dit me', 'đit mẹ', 'dit cu',
  'cho du', 'cho đụ', 'lồn bà', 'lon ba', 'cái lồn', 'cai lon',
  'con lợn', 'con lon', 'địt mẹ', 'địt má', 'mẹ mày', 'me may',
  
  // Từ chửi bới
  'ngu', 'ngốc', 'ngoc', 'chó', 'cho', 'loz', 'lol', 'lìn', 'lin',
  'đĩ', 'di', 'điếm', 'diem', 'cave', 'gái điếm', 'gai diem',
  'thằng ngu', 'thang ngu', 'con ngu', 'đồ ngu', 'do ngu',
  'mất dạy', 'mat day', 'vô dụng', 'vo dung', 'vô giáo dục', 'vo giao duc',
  
  // Xúc phạm gia đình
  'chết đi', 'chet di', 'chết mẹ', 'chet me', 'chết cha', 'chet cha',
  'bố mày', 'bo may', 'mẹ mày', 'me may', 'ông nội mày', 'ong noi may',
  'bà nội mày', 'ba noi may', 'cả nhà mày', 'ca nha may',
  
  // Từ xúc phạm động vật
  'súc vật', 'suc vat', 'đồ chó', 'do cho', 'con chó', 'thằng chó', 'thang cho',
  'con lợn', 'con lon', 'đồ lợn', 'do lon', 'con heo', 'đồ heo', 'do heo',
  'con khỉ', 'con khi', 'đồ khỉ', 'do khi', 'giống khỉ', 'giong khi',
  
  // Từ xúc phạm trí tuệ
  'óc chó', 'oc cho', 'não chó', 'nao cho', 'đầu bò', 'dau bo',
  'ngu si', 'ngu ngốc', 'ngu ngoc', 'đần độn', 'dan don',
  'trí óc con lợn', 'tri oc con lon', 'não cá vàng', 'nao ca vang',
  
  // Từ xúc phạm ngoại hình
  'xấu xí', 'xau xi', 'thối tha', 'thoi tha', 'bẩn thỉu', 'ban thiu',
  'xấu như ma', 'xau nhu ma', 'mặt lợn', 'mat lon', 'mặt heo', 'mat heo',
  
  // Đe dọa bạo lực
  'giết', 'giet', 'đánh', 'danh', 'chém', 'chem', 'giết mày', 'giet may',
  'đập', 'dap', 'đấm', 'dam', 'đá', 'da', 'chết đi mà', 'chet di ma',
  'tự tử', 'tu tu', 'tự sát', 'tu sat', 'chết cho rồi', 'chet cho roi',
  
  // Spam và công nghệ
  'ddos', 'hack', 'phá', 'pha', 'spam', 'scam', 'lừa đảo', 'lua dao',
  'virus', 'malware', 'trojan', 'keylog',
  
  // Từ phân biệt sắc tộc
  'thằng mọi', 'thang moi', 'con mọi', 'đồ mọi', 'do moi',
  'thằng tàu', 'thang tau', 'thằng tây', 'thang tay',
  
  // Từ xúc phạm tôn giáo
  'đồ phật', 'do phat', 'đồ thiên chúa', 'do thien chua',
  
  // Từ khác
  'đồ khùng', 'do khung', 'điên', 'dien', 'khùng', 'khung',
  'rác rưởi', 'rac ruoi', 'đồ rác', 'do rac', 'bựa', 'bua',
  'vô học', 'vo hoc', 'dốt', 'dot', 'thất học', 'that hoc',
];

export const BANNED_KEYWORDS_EN = [
  // English profanity
  'fuck', 'shit', 'damn', 'bitch', 'ass', 'bastard', 'cunt', 
  'dick', 'pussy', 'cock', 'motherfucker', 'asshole', 'whore',
  'slut', 'fag', 'retard', 'nigger', 'nigga',
  
  // Threats
  'kill yourself', 'kys', 'suicide', 'die', 'death threat',
  'kill you', 'murder', 'rape',
  
  // Spam
  'spam', 'scam', 'phishing', 'malware', 'virus',
];

// Tổng hợp tất cả từ khóa
export const ALL_BANNED_KEYWORDS = [
  ...BANNED_KEYWORDS_VI,
  ...BANNED_KEYWORDS_EN,
];
