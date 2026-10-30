OCA Automation - installation
=============================

1. Right-click the downloaded zip and choose "Extract All". Do not run anything from inside the zip.

2. In the extracted folder, double-click Setup.cmd.
   It first checks this computer and lists every check as PASS, WARN or FAIL:
     FAIL  must be fixed before installing; "What to do" says how.
     WARN  installation can continue, but read the note (for example, OCA needs the HPE network or VPN).
   When nothing failed, answer Y to install. No administrator rights are needed.

3. Start OCA Automation from the "OCA Automation" shortcut on the Desktop or in the Start menu.
   A window opens and the dashboard opens in your browser. Keep the window open while you work;
   close it to stop OCA Automation.

If something fails
------------------
Setup saves system-check.txt in the extracted folder. Send that file to the OCA Automation team.
Check-System.cmd runs the same checks without installing.

For a problem during a run, use the dashboard's Share button and send the zip it downloads.

Updating
--------
Download the new zip, extract it, and run Setup.cmd again. Your runs, browser sign-in and
settings are kept.

Where things are
----------------
App:       %LOCALAPPDATA%\Programs\OCA-Automation
Your data: %LOCALAPPDATA%\OCA-Automation
           settings.txt   OCA address, browser, sign-in wait, dashboard port
           runs\          every run: input, results, activity log, page captures
Uninstall: %LOCALAPPDATA%\Programs\OCA-Automation\Uninstall.cmd

Browser
-------
OCA Automation uses Microsoft Edge, or Google Chrome when Edge is not installed. To choose one,
set OCA_BROWSER=edge or OCA_BROWSER=chrome in settings.txt. The first run in each browser asks you
to sign in to OCA once; the sign-in is then remembered.
