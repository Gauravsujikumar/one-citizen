// login_screen.dart - Citizen & Admin Authentication Screen
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _isSignUp = false;
  String _selectedRole = 'citizen'; // 'citizen' or 'admin'
  String? _errorMessage;

  Future<void> _handleAuth() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      Map<String, dynamic> result;
      if (_isSignUp) {
        result = await ApiService.signUp(
          _emailController.text,
          _passwordController.text,
          role: _selectedRole,
        );
      } else {
        result = await ApiService.login(
          _emailController.text,
          _passwordController.text,
        );
      }

      if (result.containsKey('error')) {
        setState(() {
          _errorMessage = result['error'];
        });
      } else {
        // If login/signup successful, navigate to appropriate portal
        if (result['user']['role'] == 'admin') {
          Navigator.pushReplacementNamed(context, '/admin');
        } else {
          Navigator.pushReplacementNamed(context, '/dashboard');
        }
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Authentication failed. Please verify connection.';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 60.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 40),
              // Logo placeholder
              Center(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: govNavy.withOpacity(0.05),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.fingerprint, // Modern citizen identity icon
                    size: 64,
                    color: govNavy,
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Center(
                child: Text(
                  _isSignUp ? 'Create OneCitizen ID' : 'Sign In to Portal',
                  style: const TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.bold,
                    color: govNavy,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              const Center(
                child: Text(
                  'Unified Government Copilot System',
                  style: TextStyle(color: Colors.grey, fontSize: 14),
                ),
              ),
              const SizedBox(height: 40),

              if (_errorMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: TextStyle(color: Colors.red.shade800, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 20),
              ],

              // Email Field
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(
                  labelText: 'Email Address / Citizen ID',
                  prefixIcon: const Icon(Icons.email_outlined, color: govNavy),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 20),

              // Password Field
              TextFormField(
                controller: _passwordController,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: 'Password',
                  prefixIcon: const Icon(Icons.lock_outline, color: govNavy),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 20),

              // Role selector when signing up
              if (_isSignUp) ...[
                const Text(
                  'Choose Portal Role',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: govNavy),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: RadioListTile<String>(
                        title: const Text('Citizen', style: TextStyle(fontSize: 14)),
                        value: 'citizen',
                        groupValue: _selectedRole,
                        activeColor: govSaffron,
                        onChanged: (val) {
                          setState(() {
                            _selectedRole = val!;
                          });
                        },
                      ),
                    ),
                    Expanded(
                      child: RadioListTile<String>(
                        title: const Text('Admin', style: TextStyle(fontSize: 14)),
                        value: 'admin',
                        groupValue: _selectedRole,
                        activeColor: govSaffron,
                        onChanged: (val) {
                          setState(() {
                            _selectedRole = val!;
                          });
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
              ],

              // Submit Button
              ElevatedButton(
                onPressed: _isLoading ? null : _handleAuth,
                style: ElevatedButton.styleFrom(
                  backgroundColor: govNavy,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : Text(
                        _isSignUp ? 'Register Citizen Profile' : 'Authenticate Identity',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
              ),
              const SizedBox(height: 20),

              // SignUp Toggle
              TextButton(
                onPressed: () {
                  setState(() {
                    _isSignUp = !_isSignUp;
                    _errorMessage = null;
                  });
                },
                child: Text(
                  _isSignUp ? 'Already have a Citizen ID? Sign In' : 'New Citizen? Register Profile',
                  style: const TextStyle(color: govSaffron, fontWeight: FontWeight.bold),
                ),
              ),
              
              // Mock Login shortcuts to help evaluation
              const SizedBox(height: 30),
              const Divider(color: Colors.black12),
              const SizedBox(height: 10),
              const Text(
                'Hackathon Instant Access Mocks:',
                style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  OutlinedButton(
                    onPressed: () {
                      _emailController.text = 'citizen@onecitizen.gov.in';
                      _passwordController.text = 'password123';
                      _isSignUp = false;
                      _handleAuth();
                    },
                    child: const Text('Citizen Mock'),
                  ),
                  OutlinedButton(
                    onPressed: () {
                      _emailController.text = 'admin@onecitizen.gov.in';
                      _passwordController.text = 'admin123';
                      _isSignUp = false;
                      _selectedRole = 'admin';
                      _handleAuth();
                    },
                    child: const Text('Admin Mock'),
                  ),
                ],
              )
            ],
          ),
        ),
      ),
    );
  }
}
