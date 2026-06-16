// splash_screen.dart - Application Splash Screen
import 'dart:async';
import 'package:flutter/material.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  int _currentPhase = 1;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _fadeAnimation = CurvedAnimation(parent: _controller, curve: Curves.easeIn);
    _controller.forward();

    // Sequence the loading screens:
    // Phase 1 (App Branding) -> Phase 2 (State Loading) -> Login Screen
    Timer(const Duration(milliseconds: 2000), () {
      if (mounted) {
        setState(() {
          _currentPhase = 2;
        });
        _controller.reset();
        _controller.forward();
      }
    });

    Timer(const Duration(milliseconds: 4500), () {
      if (mounted) {
        Navigator.pushReplacementNamed(context, '/login');
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const Color govNavy = Color(0xFF0F294A);
    const Color govSaffron = Color(0xFFFF671F);
    const Color govGold = Color(0xFFD4AF37);
    const Color govEmerald = Color(0xFF046A38);
    
    return Scaffold(
      backgroundColor: govNavy,
      body: Center(
        child: FadeTransition(
          opacity: _fadeAnimation,
          child: _currentPhase == 1 
            ? _buildPhase1(govNavy, govSaffron) 
            : _buildPhase2(govNavy, govGold, govEmerald),
        ),
      ),
    );
  }

  Widget _buildPhase1(Color govNavy, Color govSaffron) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Ashok Chakra Motifs / AI Circle logo representation
        Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: govSaffron, width: 4),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 15,
                offset: const Offset(0, 5),
              )
            ],
          ),
          child: const Center(
            child: Icon(
              Icons.account_balance, // Government Pillar Icon
              size: 60,
              color: govNavy,
            ),
          ),
        ),
        const SizedBox(height: 40),
        
        const CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation<Color>(govSaffron),
        ),
      ],
    );
  }

  Widget _buildPhase2(Color govNavy, Color govGold, Color govEmerald) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Government of Telangana State Emblem/Seal
        Container(
          width: 140,
          height: 140,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: govGold, width: 2),
            boxShadow: [
              BoxShadow(
                color: govEmerald.withOpacity(0.25),
                blurRadius: 25,
                spreadRadius: 5,
              )
            ],
          ),
          child: Center(
            child: ClipOval(
              child: Image.asset(
                'assets/images/telangana_logo.jpg',
                width: 124,
                height: 124,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  // Fallback if the image doesn't load/exist
                  return const Icon(
                    Icons.account_balance,
                    size: 70,
                    color: govNavy,
                  );
                },
              ),
            ),
          ),
        ),
        const SizedBox(height: 20),

        // State Name (English)
        const Text(
          'Government of Telangana',
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(height: 6),

        // State Name (Telugu)
        const Text(
          'తెలంగాణ ప్రభుత్వం',
          style: TextStyle(
            color: govGold,
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 30),
        
        const CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation<Color>(govEmerald),
        ),
      ],
    );
  }
}
