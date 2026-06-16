// main.dart - OneCitizen AI Flutter Mobile Application Entry Point
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Import Screens
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/vault_screen.dart';
import 'screens/service_discovery_screen.dart';
import 'screens/scheme_recommendation_screen.dart';
import 'screens/meeseva_locator_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/admin_dashboard_screen.dart';

void main() {
  runApp(
    const ProviderScope(
      child: OneCitizenApp(),
    ),
  );
}

class OneCitizenApp extends StatelessWidget {
  const OneCitizenApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Custom GovTech Color Palette
    const Color govNavy = Color(0xFF0F294A);      // Primary Navy Blue
    const Color govNavyLight = Color(0xFF1F3E64); // Secondary Corporate Blue
    const Color govSaffron = Color(0xFFFF671F);    // Accent Saffron
    const Color govEmerald = Color(0xFF046A38);    // Success Emerald Green
    const Color govGold = Color(0xFFD4AF37);       // Warning/Seal Gold

    return MaterialApp(
      title: 'OneCitizen AI',
      debugShowCheckedModeBanner: false,
      
      // Light Mode Theme
      theme: ThemeData(
        useMaterial3: true,
        primaryColor: govNavy,
        colorScheme: ColorScheme.fromSeed(
          seedColor: govNavy,
          primary: govNavy,
          secondary: govSaffron,
          tertiary: govEmerald,
          surface: const Color(0xFFF8FAFC),
          background: const Color(0xFFF8FAFC),
          error: const Color(0xFFDC2626),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: govNavy,
          foregroundColor: Colors.white,
          elevation: 2,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: govNavy,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
          ),
        ),
        cardTheme: CardTheme(
          color: Colors.white,
          elevation: 1,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: Colors.white,
          indicatorColor: govSaffron.withOpacity(0.2),
          labelTextStyle: MaterialStateProperty.all(
            const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: govNavy),
          ),
        ),
      ),

      // Dark Mode Theme
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        primaryColor: govNavy,
        colorScheme: ColorScheme.fromSeed(
          seedColor: govNavy,
          brightness: Brightness.dark,
          primary: govNavyLight,
          secondary: govSaffron,
          tertiary: govEmerald,
          background: const Color(0xFF0A0F1D),
          surface: const Color(0xFF131A2E),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0A0F1D),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
      ),
      themeMode: ThemeMode.system, // Supports automatic dark mode matching system setting

      // Routing Table
      initialRoute: '/',
      routes: {
        '/': (context) => const SplashScreen(),
        '/login': (context) => const LoginScreen(),
        '/dashboard': (context) => const DashboardScreen(),
        '/profile': (context) => const ProfileScreen(),
        '/vault': (context) => const VaultScreen(),
        '/services': (context) => const ServiceDiscoveryScreen(),
        '/schemes': (context) => const SchemeRecommendationScreen(),
        '/meeseva': (context) => const MeeSevaLocatorScreen(),
        '/notifications': (context) => const NotificationsScreen(),
        '/admin': (context) => const AdminDashboardScreen(),
      },
    );
  }
}
