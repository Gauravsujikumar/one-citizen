// api_service.dart - OneCitizen AI API Client for Flutter Mobile
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'http://10.0.2.2:3000/api'; // Android Emulator localhost bridge
  static String? _token;
  static int? _userId;
  static String? _userEmail;
  static String? _userRole;

  static void setToken(String token, int userId, String email, String role) {
    _token = token;
    _userId = userId;
    _userEmail = email;
    _userRole = role;
  }

  static Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (_token != null) 'Authorization': 'Bearer $_token',
  };

  // User Sign Up
  static Future<Map<String, dynamic>> signUp(String email, String password, {String role = 'citizen'}) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/signup'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password, 'role': role}),
    );
    final data = jsonDecode(response.body);
    if (response.statusCode == 201) {
      setToken(data['token'], data['user']['id'], data['user']['email'], data['user']['role']);
    }
    return data;
  }

  // User Login
  static Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final data = jsonDecode(response.body);
    if (response.statusCode == 200) {
      setToken(data['token'], data['user']['id'], data['user']['email'], data['user']['role']);
    }
    return data;
  }

  // Fetch Citizen Digital Twin Profile
  static Future<Map<String, dynamic>> getProfile() async {
    final response = await http.get(Uri.parse('$baseUrl/auth/profile'), headers: _headers);
    return jsonDecode(response.body);
  }

  // Update Profile
  static Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> profileData) async {
    final response = await http.put(
      Uri.parse('$baseUrl/auth/profile'),
      headers: _headers,
      body: jsonEncode(profileData),
    );
    return jsonDecode(response.body);
  }

  // Fetch Document Vault
  static Future<List<dynamic>> getDocuments() async {
    final response = await http.get(Uri.parse('$baseUrl/documents'), headers: _headers);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List;
    }
    throw Exception('Failed to load documents');
  }

  // Upload Document to Vault (Triggers OCR & Profile auto-fill)
  static Future<Map<String, dynamic>> uploadDocument(File file, String docType) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/documents/upload'));
    if (_token != null) {
      request.headers['Authorization'] = 'Bearer $_token';
    }
    request.fields['document_type'] = docType;
    request.files.add(await http.MultipartFile.fromPath('document', file.path));

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);
    return jsonDecode(response.body);
  }

  // Delete Document
  static Future<Map<String, dynamic>> deleteDocument(String id) async {
    final response = await http.delete(Uri.parse('$baseUrl/documents/$id'), headers: _headers);
    return jsonDecode(response.body);
  }

  // Service Catalog
  static Future<List<dynamic>> getServices({String? search, String? category}) async {
    String query = '';
    if (search != null || category != null) {
      final params = <String>[];
      if (search != null) params.add('search=$search');
      if (category != null) params.add('category=$category');
      query = '?${params.join('&')}';
    }
    final response = await http.get(Uri.parse('$baseUrl/services$query'), headers: _headers);
    return jsonDecode(response.body) as List;
  }

  // Scheme Recommendations
  static Future<List<dynamic>> getSchemeRecommendations() async {
    final response = await http.get(Uri.parse('$baseUrl/services/recommendations/list'), headers: _headers);
    return jsonDecode(response.body) as List;
  }

  // Get Auto-filled Form Fields
  static Future<Map<String, dynamic>> getAutoFillFields(int serviceId) async {
    final response = await http.get(Uri.parse('$baseUrl/services/auto-fill/$serviceId'), headers: _headers);
    return jsonDecode(response.body);
  }

  // Get Readiness Score
  static Future<Map<String, dynamic>> getReadinessScore(int serviceId) async {
    final response = await http.get(Uri.parse('$baseUrl/services/readiness/$serviceId'), headers: _headers);
    return jsonDecode(response.body);
  }

  // Submit Application
  static Future<Map<String, dynamic>> submitApplication(Map<String, dynamic> appData) async {
    final response = await http.post(
      Uri.parse('$baseUrl/services/submit'),
      headers: _headers,
      body: jsonEncode(appData),
    );
    return jsonDecode(response.body);
  }

  // MeeSeva Locator
  static Future<List<dynamic>> getMeeSevaCenters(double lat, double lon) async {
    final response = await http.get(
      Uri.parse('$baseUrl/meeseva/locate?latitude=$lat&longitude=$lon'),
      headers: _headers,
    );
    return jsonDecode(response.body) as List;
  }

  // Admin Analytics
  static Future<Map<String, dynamic>> getAdminAnalytics() async {
    final response = await http.get(Uri.parse('$baseUrl/admin/analytics'), headers: _headers);
    return jsonDecode(response.body);
  }
}
