import Foundation

/// 桌面账号页白名单（与后端 `get_current_account_user` 对齐）：资料、昵称、联系邮箱、偏好与求职画像。
/// 头像上传与移除也在其中；桌面端不提供密码、微信绑定与注销账号。
public enum AccountRequest {
    public static func allowed(path: String, method: String) -> Bool {
        switch path {
        case "/api/account/profile", "/api/account/preferences": return ["GET", "PATCH"].contains(method)
        case "/api/account/contact-email": return method == "PUT"
        case "/api/account/user-profile": return ["GET", "PUT"].contains(method)
        case "/api/account/avatar": return ["PUT", "DELETE"].contains(method)
        default: return false
        }
    }

    public static func errorMessage(_ error: Error, fallback: String) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。" }
        guard case APIError.server(_, let code) = error else { return fallback }
        return [
            "INVALID_NICKNAME": "昵称需要 1–50 个字符。",
            "INVALID_CONTACT_EMAIL": "请输入有效的邮箱地址。",
            "INVALID_ACCOUNT_PREFERENCES": "偏好设置无效，请刷新后重试。",
            "USER_PROFILE_VERSION_CONFLICT": "求职资料已在其他设备更新，已为你读取最新版本，请确认后再保存。",
            "INVALID_IMAGE": "只支持 PNG 或 JPEG 图片。",
            "IMAGE_TOO_LARGE": "图片超过 10 MB，请换一张。",
            "ASSET_UPLOAD_FAILED": "头像上传失败，请稍后重试。",
            "DESKTOP_ROUTE_FORBIDDEN": "桌面端不提供此操作。",
        ][code] ?? fallback
    }
}

/// 求职画像（`GET/PUT /api/account/user-profile`，Web `UserProfilePanel`）。
public struct UserProfileForm: Equatable, Sendable {
    public var cities: [String] = []
    public var salaryMin = ""
    public var salaryMax = ""
    public var salaryCurrency = ""
    public var salaryPeriod = ""
    public var employmentTypes: [String] = []
    public var school = ""
    public var schoolTier: [String] = []
    public var major = ""
    public var educationLevel = ""
    public var candidateStatus = ""
    public var graduationYear = ""
    public var yearsExperience = ""
    public var languages: [String] = []
    public var skills: [String] = []
    public var certifications: [String] = []
    public var honors: [String] = []
    public var campusExperiences: [String] = []
    public var lockVersion = 1

    public static let employment = [("internship", "实习"), ("full_time", "全职")]
    public static let status = [("fresh_graduate", "应届生"), ("experienced", "非应届生")]
    public static let period = [("month", "月薪"), ("year", "年薪"), ("day", "日薪"), ("hour", "时薪")]
    public static let education = [("high_school", "高中及以下"), ("junior_college", "大专"), ("bachelor", "本科"), ("master", "硕士"), ("doctor", "博士")]
    public static let tiers = [("project_985", "985 院校"), ("project_211", "211 院校"), ("double_first_class", "双一流")]

    public init() {}

    public init(_ value: JSONValue) {
        let list = { (key: String) in (value[key]?.items ?? []).compactMap(\.stringValue) }
        let number = { (key: String) -> String in
            if let number = value[key]?.numberValue { return number == number.rounded() ? String(Int(number)) : String(number) }
            return value[key]?.stringValue ?? ""
        }
        cities = list("candidate_cities"); employmentTypes = list("employment_types"); schoolTier = list("school_tier")
        languages = list("languages"); skills = list("skills"); certifications = list("certifications")
        honors = list("honors"); campusExperiences = list("campus_experiences")
        salaryMin = number("salary_min"); salaryMax = number("salary_max")
        salaryCurrency = value["salary_currency"]?.stringValue ?? ""; salaryPeriod = value["salary_period"]?.stringValue ?? ""
        school = value["school"]?.stringValue ?? ""; major = value["major"]?.stringValue ?? ""
        educationLevel = value["education_level"]?.stringValue ?? ""; candidateStatus = value["candidate_status"]?.stringValue ?? ""
        graduationYear = number("graduation_year"); yearsExperience = number("years_experience")
        lockVersion = value["lock_version"]?.numberValue.map { Int($0) } ?? 1
    }

    /// 完整替换写入；去重去空白，空字符串写 null。应届生的工作年限按 Web 规则写 0。
    public func payload() -> JSONValue {
        func text(_ value: String) -> JSONValue {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? .null : .string(trimmed)
        }
        func decimal(_ value: String) -> JSONValue {
            Double(value.trimmingCharacters(in: .whitespaces)).flatMap { $0 >= 0 ? JSONValue.number($0) : nil } ?? .null
        }
        func integer(_ value: String) -> JSONValue { Int(value.trimmingCharacters(in: .whitespaces)).map { .number(Double($0)) } ?? .null }
        func list(_ values: [String]) -> JSONValue {
            var seen = Set<String>()
            return .array(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && seen.insert($0).inserted }.map(JSONValue.string))
        }
        let currency = salaryCurrency.trimmingCharacters(in: .whitespaces).uppercased()
        return .object([
            "candidate_cities": list(Array(cities.prefix(20))), "salary_min": decimal(salaryMin), "salary_max": decimal(salaryMax),
            "salary_currency": currency.isEmpty ? .null : .string(String(currency.prefix(3))), "salary_period": text(salaryPeriod),
            "employment_types": list(employmentTypes), "school": text(school), "school_tier": list(schoolTier), "major": text(major),
            "education_level": text(educationLevel), "candidate_status": text(candidateStatus),
            "graduation_year": candidateStatus == "fresh_graduate" ? integer(graduationYear) : .null,
            "years_experience": candidateStatus == "fresh_graduate" ? .number(0) : integer(yearsExperience),
            "languages": list(languages), "skills": list(skills), "certifications": list(certifications),
            "honors": list(honors), "campus_experiences": list(campusExperiences),
            "base_lock_version": .number(Double(lockVersion)),
        ])
    }

    /// 与 Web `profileProgress` 同一组计入项。
    public var progress: (filled: Int, total: Int) {
        let has = { (values: [String]) in values.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty && $0.trimmingCharacters(in: .whitespaces) != "无" } }
        let items = [
            !employmentTypes.isEmpty, !candidateStatus.isEmpty, !cities.isEmpty, !salaryMin.isEmpty || !salaryMax.isEmpty,
            candidateStatus == "fresh_graduate" ? !graduationYear.isEmpty : !yearsExperience.isEmpty,
            !educationLevel.isEmpty, !school.isEmpty, !major.isEmpty, !schoolTier.isEmpty,
            has(skills), has(languages), has(certifications), has(honors), has(campusExperiences),
        ]
        return (items.filter { $0 }.count, items.count)
    }
}
